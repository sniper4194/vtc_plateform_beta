import { Body, Controller, Get, Headers, HttpException, Inject, Injectable, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Partner } from "@prisma/client";
import { NEEDS, VehicleCategorySchema } from "@vtc/shared";
import { z } from "zod";
import { parisToUtc } from "./csv-import";
import { BookSchema, HostedService, HUBS, TripSchema } from "./hosted";
import { euros, parse } from "./http";
import { PrismaService } from "./prisma";
import { PartnerGuard } from "./security";

/**
 * Espace hôtel : la réception commande les transferts de ses clients depuis une tablette ou un ordinateur.
 * Pourquoi un espace à part de la page publique /reserver : la réception doit retrouver toutes ses courses
 * (suivi, annulation, relevé du mois) et choisir qui paie (l'hôtel en fin de mois, ou le client à bord).
 * Connexion par la clé d'API du partenaire (choix de l'utilisateur) : mêmes droits que l'API, rien de plus.
 */
const HotelBookSchema = BookSchema.omit({ code: true }).extend({
  // Numéro de chambre ou référence interne de l'hôtel, repris sur le relevé.
  room: z.string().trim().max(20).optional(),
});
const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mois au format AAAA-MM");

function parisMonth(d = new Date()) {
  const p = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(d);
  return p.slice(0, 7);
}

/** Début et fin (exclue) d'un mois, en heure de Paris. */
export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: parisToUtc(y, m, 1, 0, 0), to: m === 12 ? parisToUtc(y + 1, 1, 1, 0, 0) : parisToUtc(y, m + 1, 1, 0, 0) };
}

@Injectable()
export class HotelPortalService {
  constructor(@Inject(PrismaService) private prisma: PrismaService, @Inject(HostedService) private hosted: HostedService) {}

  session(p: Partner) {
    return {
      name: p.name,
      // null : l'adresse n'est pas encore saisie par l'équipe CliCab, la commande est alors impossible.
      place: p.hostedAddress && p.hostedLat != null && p.hostedLng != null ? { label: p.hostedPlaceLabel ?? p.name, address: p.hostedAddress } : null,
      hubs: HUBS.map(({ id, label, airport }) => ({ id, label, airport })), categories: VehicleCategorySchema.options, needs: NEEDS,
    };
  }

  quote(p: Partner, body: unknown) {
    return this.hosted.tripQuote(p, parse(TripSchema.omit({ code: true }), body));
  }

  async book(p: Partner, sandbox: boolean, key: string | undefined, body: unknown) {
    if (!key || key.length > 100) throw new HttpException("En-tête Idempotency-Key requis (≤ 100 caractères)", 400);
    const b = parse(HotelBookSchema, body);
    const v = await this.hosted.createBooking(p, `hotel-${key}`, b, b.room ? `Chambre ${b.room}` : "HOTEL", sandbox);
    return { id: v.id, reference: v.reference, total: v.total, trackingUrl: v.trackingUrl };
  }

  /** Courses du mois (heure de Paris) et totaux. Relevé indicatif : la facturation n'est pas encore construite. */
  async bookings(p: Partner, month?: string) {
    const m = month ? parse(MonthSchema, month) : parisMonth();
    const { from, to } = monthBounds(m);
    const rides = await this.prisma.ride.findMany({
      where: { booking: { partnerId: p.id }, pickupAt: { gte: from, lt: to } },
      include: { booking: true, driver: true, vehicle: true }, orderBy: { pickupAt: "asc" }, take: 1000,
    });
    let billedCents = 0, onBoardCents = 0, unpaidCents = 0, feesCents = 0;
    const rows = rides.map((r) => {
      if (r.status === "COMPLETED") { if (!r.payOnBoard) billedCents += r.priceCents; else if (r.onBoardPayment === "PAID") onBoardCents += r.priceCents; else unpaidCents += r.priceCents; }
      if (r.status === "CANCELLED_BY_PARTNER" && r.cancellationFeeCents) feesCents += r.cancellationFeeCents;
      return {
        id: r.booking.id, reference: `R-${r.ref}`, status: r.status, pickupAt: r.pickupAt.toISOString(),
        pickup: r.pickupAddress, dropoff: r.dropoffAddress, room: r.booking.externalReference,
        passenger: `${r.booking.passengerFirstName} ${r.booking.passengerLastName}`.trim(), flightNumber: r.booking.flightNumber,
        payOnBoard: r.payOnBoard, onBoardPayment: r.payOnBoard && r.onBoardPayment ? { status: r.onBoardPayment, reason: r.onBoardPaymentReason, resolved: !!r.onBoardPaymentResolvedAt } : null, total: euros(r.priceCents), cancellationFee: r.cancellationFeeCents ? euros(r.cancellationFeeCents) : null,
        driver: r.driver ? { firstName: r.driver.firstName, vehicle: r.vehicle ? `${r.vehicle.make} ${r.vehicle.model}` : null, plate: r.vehicle?.plate ?? null } : null,
        trackingUrl: r.booking.trackingToken ? `${(process.env.TRACKING_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "")}/suivi/${r.booking.trackingToken}` : null,
      };
    });
    return { month: m, rows, totals: { billed: euros(billedCents), onBoard: euros(onBoardCents), unpaidOnBoard: euros(unpaidCents), cancellationFees: euros(feesCents) } };
  }
}

@Controller("v1/hotel")
@UseGuards(PartnerGuard)
export class HotelPortalController {
  constructor(@Inject(HotelPortalService) private svc: HotelPortalService) {}
  @Get("session") session(@Req() req: any) { return this.svc.session(req.partner); }
  @Post("quote") quote(@Req() req: any, @Body() body: unknown) { return this.svc.quote(req.partner, body); }
  @Post("bookings") book(@Req() req: any, @Headers("idempotency-key") key: string | undefined, @Body() body: unknown) { return this.svc.book(req.partner, req.sandbox, key, body); }
  @Get("bookings") list(@Req() req: any, @Query("month") month?: string) { return this.svc.bookings(req.partner, month); }
}
