import { Body, Controller, Get, Headers, HttpException, Inject, Injectable, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Partner } from "@prisma/client";
import { NEEDS, VehicleCategorySchema } from "@vtc/shared";
import { z } from "zod";
import { parisToUtc } from "./csv-import";
import { GeocodeService } from "./geocode";
import { BookSchema, HostedService, HUBS, TripSchema } from "./hosted";
import { asapLeadMin, DETAILS_SCHEMA, RANGE_INFO, rangeFeatures, rangeOf } from "./partner-ranges";
import { QuotesService } from "./quotes.service";
import { euros, parse } from "./http";
import { PrismaService } from "./prisma";
import { PartnerGuard } from "./security";

/**
 * Espace hôtel : la réception commande les transferts de ses clients depuis une tablette ou un ordinateur.
 * Pourquoi un espace à part de la page publique /reserver : la réception doit retrouver toutes ses courses
 * (suivi, annulation, relevé du mois) et choisir qui paie (l'hôtel en fin de mois, ou le client à bord).
 * Connexion par la clé d'API du partenaire (choix de l'utilisateur) : mêmes droits que l'API, rien de plus.
 * L'espace s'adapte à la gamme du partenaire (Hôtel, Dépannage, Association, Care) : champs, adresses libres,
 * aller-retour, commande « dès que possible » (voir partner-ranges.ts).
 */
const HotelBookSchema = BookSchema.omit({ code: true }).extend({
  // Numéro de chambre ou référence interne de l'hôtel, repris sur le relevé.
  room: z.string().trim().max(20).optional(),
  // Aller-retour : devis du trajet retour, obtenu avec le devis aller.
  returnQuoteId: z.string().uuid().optional(),
  // Champs propres à la gamme, vérifiés selon la gamme du partenaire.
  details: z.record(z.unknown()).optional(),
  asap: z.boolean().optional(),
});
/** Adresses libres (Dépannage, Association, Care) : retrouvées par la Base Adresse Nationale. */
const FreeTripSchema = z.object({
  pickupAddress: z.string().trim().min(5).max(200),
  dropoffAddress: z.string().trim().min(5).max(200),
  pickupAt: z.string().datetime().optional(),
  asap: z.literal(true).optional(),
  returnAt: z.string().datetime().optional(),
  category: VehicleCategorySchema,
  passengers: z.number().int().min(1).max(8),
  luggage: z.number().int().min(0).max(12).default(0),
}).strict().refine((t) => !!t.pickupAt !== !!t.asap, { message: "indiquer l'heure de prise en charge ou « dès que possible »", path: ["pickupAt"] });
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
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(HostedService) private hosted: HostedService,
    @Inject(QuotesService) private quotes: QuotesService,
    @Inject(GeocodeService) private geo: GeocodeService,
  ) {}

  session(p: Partner) {
    const range = rangeOf(p.range);
    return {
      name: p.name, range, space: range ? RANGE_INFO[range].space : "Espace hôtel", rangeLabel: range ? RANGE_INFO[range].label : null,
      addressMode: range ? RANGE_INFO[range].addressMode : "hub", features: rangeFeatures(range), asapLeadMin: asapLeadMin(),
      // null : l'adresse n'est pas encore saisie par l'équipe CliCab, la commande est alors impossible.
      place: p.hostedAddress && p.hostedLat != null && p.hostedLng != null ? { label: p.hostedPlaceLabel ?? p.name, address: p.hostedAddress } : null,
      hubs: HUBS.map(({ id, label, airport }) => ({ id, label, airport })), categories: VehicleCategorySchema.options, needs: NEEDS,
    };
  }

  quote(p: Partner, body: unknown) {
    if (body && typeof body === "object" && "hub" in body) return this.hosted.tripQuote(p, parse(TripSchema.omit({ code: true }), body));
    return this.freeQuote(p, parse(FreeTripSchema, body));
  }

  private async place(address: string, field: string) {
    const f = await this.geo.find(address);
    if (!f) throw new HttpException({ message: `Adresse introuvable : « ${address} ». Précisez le numéro, la rue et la ville.`, errors: { [field]: ["adresse introuvable"] } }, 422);
    return { address: f.label, lat: f.lat, lng: f.lng };
  }

  private async freeQuote(p: Partner, t: z.infer<typeof FreeTripSchema>) {
    const f = rangeFeatures(rangeOf(p.range));
    if (t.asap && !f.asap) throw new HttpException("Commande « dès que possible » non proposée pour ce partenaire", 422);
    if (t.returnAt && !f.returnTrip) throw new HttpException("Aller-retour non proposé pour ce partenaire", 422);
    const [pickup, dropoff] = await Promise.all([this.place(t.pickupAddress, "pickupAddress"), this.place(t.dropoffAddress, "dropoffAddress")]);
    const pickupAt = t.asap ? new Date(Date.now() + asapLeadMin() * 60_000).toISOString() : t.pickupAt!;
    const trip = { category: t.category, passengers: t.passengers, luggage: t.luggage };
    const q = await this.quotes.create(p, { pickup, dropoff, pickupAt, ...trip });
    let ret: { quoteId: string; total: number; pickupAt: string } | undefined;
    if (t.returnAt) {
      // Le retour ne peut pas partir avant l'arrivée de l'aller.
      if (new Date(t.returnAt).getTime() < new Date(pickupAt).getTime() + q.durationMin * 60_000) throw new HttpException({ message: "L'heure de retour doit être après l'arrivée de l'aller.", errors: { returnAt: ["trop tôt"] } }, 422);
      const r = await this.quotes.create(p, { pickup: dropoff, dropoff: pickup, pickupAt: t.returnAt, ...trip });
      ret = { quoteId: r.quoteId, total: r.total, pickupAt: t.returnAt };
    }
    return { ...q, pickup: pickup.address, dropoff: dropoff.address, pickupAt, ...(ret ? { return: ret } : {}) };
  }

  async book(p: Partner, sandbox: boolean, key: string | undefined, body: unknown) {
    if (!key || key.length > 100) throw new HttpException("En-tête Idempotency-Key requis (≤ 100 caractères)", 400);
    const b = parse(HotelBookSchema, body);
    const range = rangeOf(p.range);
    const details = parse(DETAILS_SCHEMA[range ?? "HOTEL"], b.details ?? {}) as Record<string, unknown>;
    if (b.returnQuoteId && !rangeFeatures(range).returnTrip) throw new HttpException("Aller-retour non proposé pour ce partenaire", 422);
    const ref = b.room ? `Chambre ${b.room}` : details.caseNumber ? `Dossier ${details.caseNumber}` : range ? RANGE_INFO[range].label : "HOTEL";
    const extra = { ...details, ...(b.asap && rangeFeatures(range).asap ? { asap: true } : {}) };
    const go = await this.hosted.createBooking(p, `hotel-${key}`, b, ref, sandbox);
    await this.prisma.booking.update({ where: { id: go.id }, data: { details: { ...extra, ...(b.returnQuoteId ? { leg: "ALLER" } : {}) } as any } });
    const out: any = { id: go.id, reference: go.reference, total: go.total, trackingUrl: go.trackingUrl };
    if (b.returnQuoteId) {
      const back = await this.hosted.createBooking(p, `hotel-${key}-retour`, { ...b, quoteId: b.returnQuoteId }, ref, sandbox);
      await this.prisma.booking.update({ where: { id: back.id }, data: { details: { ...extra, leg: "RETOUR" } as any } });
      out.return = { id: back.id, reference: back.reference, total: back.total };
    }
    return out;
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
