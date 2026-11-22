import { HttpException, Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Partner } from "@prisma/client";
import { BookingRequest, canTransition } from "@vtc/shared";
import { DispatchService } from "./dispatch.service";
import { euros } from "./http";
import { shareablePhoto } from "./identity.service";
import { cancellationMessage } from "./messages";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";
import { bookingView, RideFull } from "./views";
import { WebhooksService } from "./webhooks.service";

/** Politique d'annulation PROVISOIRE (à valider commercialement par partenaire). */
export function cancellationFeeCents(priceCents: number, pickupAt: Date, now = new Date()): number {
  const hours = (pickupAt.getTime() - now.getTime()) / 3600_000;
  if (hours >= 24) return 0;
  if (hours >= 2) return Math.round(priceCents * 0.5);
  return priceCents;
}

const include = { booking: true, driver: true, vehicle: true } as const;

/** Part des frais d'annulation reversée au chauffeur : les frais moins la commission de la plateforme (même taux que la course). */
export { cancellationMessage };

export function driverCompensationCents(feeCents: number, ride: { priceCents: number; commissionCents: number }): number {
  if (feeCents <= 0 || ride.priceCents <= 0) return 0;
  return feeCents - Math.round((feeCents * ride.commissionCents) / ride.priceCents);
}

@Injectable()
export class BookingsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(DispatchService) private dispatch: DispatchService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  private async findForPartner(partner: Partner, bookingId: string): Promise<RideFull> {
    const ride = await this.prisma.ride.findFirst({ where: { bookingId, booking: { partnerId: partner.id } }, include });
    if (!ride) throw new HttpException("Réservation introuvable", 404);
    return ride;
  }

  async get(partner: Partner, bookingId: string) {
    return bookingView(await this.findForPartner(partner, bookingId));
  }

  /** Photo du chauffeur affecté : uniquement pour le partenaire qui a réservé, et seulement entre l'attribution et la fin de la course. */
  async driverPhoto(partner: Partner, bookingId: string): Promise<{ mime: string; image: Buffer }> {
    const ride = await this.findForPartner(partner, bookingId);
    if (!ride.driverId || !["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(ride.status)) throw new HttpException("Photo indisponible", 404);
    const photo = await shareablePhoto(this.prisma, ride.driverId); // consentement du chauffeur + photo validée
    if (!photo) throw new HttpException("Photo indisponible", 404);
    return photo;
  }

  async create(partner: Partner, idempotencyKey: string, req: BookingRequest, sandbox: boolean) {
    const existing = await this.prisma.booking.findUnique({
      where: { partnerId_idempotencyKey: { partnerId: partner.id, idempotencyKey } },
    });
    if (existing) return { created: false, booking: await this.get(partner, existing.id) };

    let rideId: string;
    try {
      rideId = await this.prisma.$transaction(async (tx) => {
        const quote = await tx.quote.findFirst({ where: { id: req.quoteId, partnerId: partner.id } });
        if (!quote) throw new HttpException("Devis introuvable", 404);
        if (quote.expiresAt <= new Date()) throw new HttpException("Devis expiré", 409);
        const used = await tx.quote.updateMany({ where: { id: quote.id, usedAt: null }, data: { usedAt: new Date() } });
        if (used.count !== 1) throw new HttpException("Devis déjà utilisé", 409);

        const r = quote.request as any;
        const booking = await tx.booking.create({
          data: {
            partnerId: partner.id, idempotencyKey, externalReference: req.externalReference,
            passengerFirstName: req.passenger.firstName, passengerLastName: req.passenger.lastName,
            passengerPhone: req.passenger.phone, passengerEmail: req.passenger.email, signText: req.signText, notes: req.notes,
            passengerLanguage: req.passenger.language, flightNumber: r.flightNumber,
            trackingToken: randomBytes(24).toString("base64url"),
          },
        });
        const ride = await tx.ride.create({
          data: {
            bookingId: booking.id, status: "DISPATCHING", category: quote.category,
            pickupAddress: r.pickup.address, pickupLat: r.pickup.lat, pickupLng: r.pickup.lng,
            dropoffAddress: r.dropoff.address, dropoffLat: r.dropoff.lat, dropoffLng: r.dropoff.lng,
            pickupAt: quote.pickupAt, distanceKm: quote.distanceKm, durationMin: quote.durationMin,
            passengers: r.passengers, luggage: r.luggage ?? 0,
            priceCents: quote.priceCents, commissionCents: quote.commissionCents,
            driverNetCents: quote.driverNetCents, driverCapCents: quote.driverNetCents, flatRateId: quote.flatRateId, flightBufferMin: r.flightNumber ? req.flightBufferMin ?? 0 : 0,
          },
        });
        await tx.rideEvent.create({ data: { rideId: ride.id, type: "booking.confirmed", actor: `partner:${partner.id}`, payload: { sandbox } } });
        await this.webhooks.enqueue(tx, ride.id, "booking.confirmed");
        return ride.id;
      });
    } catch (e) {
      // Requêtes simultanées avec la même clé : la perdante attend le verrou du devis, puis échoue
      // (unique violé ou « devis déjà utilisé »). Si la gagnante a validé, on rejoue sa réponse.
      const won = await this.prisma.booking.findUnique({ where: { partnerId_idempotencyKey: { partnerId: partner.id, idempotencyKey } } });
      if (won) return { created: false, booking: await this.get(partner, won.id) };
      throw e;
    }
    await this.dispatch.start(rideId);
    void this.notif.trackingLink(rideId, sandbox); // SMS + e-mail au voyageur, sans retarder la réponse au partenaire
    const ride = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include });
    return { created: true, booking: bookingView(ride) };
  }

  async rate(partner: Partner, bookingId: string, score: number, comment?: string) {
    const ride = await this.findForPartner(partner, bookingId);
    if (ride.status !== "COMPLETED" || !ride.driverId) throw new HttpException("La course doit être terminée pour être notée", 409);
    await this.prisma.rating.upsert({ where: { rideId: ride.id }, create: { rideId: ride.id, score, comment }, update: { score, comment } });
    const agg = await this.prisma.rating.aggregate({ _avg: { score: true }, where: { ride: { driverId: ride.driverId } } });
    await this.prisma.driver.update({ where: { id: ride.driverId }, data: { rating: Math.round((agg._avg.score ?? 5) * 10) / 10 } });
    return { ok: true };
  }

  async cancel(partner: Partner, bookingId: string) {
    const ride = await this.findForPartner(partner, bookingId);
    if (!canTransition(ride.status, "CANCELLED_BY_PARTNER")) throw new HttpException(`Annulation impossible (statut ${ride.status})`, 409);
    const fee = cancellationFeeCents(ride.priceCents, ride.pickupAt);
    // Le chauffeur n'est indemnisé que s'il était affecté à la mission au moment de l'annulation.
    const compensation = ride.driverId ? driverCompensationCents(fee, ride) : 0;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.ride.updateMany({
        where: { id: ride.id, status: ride.status },
        data: { status: "CANCELLED_BY_PARTNER", version: { increment: 1 }, cancelledAt: new Date(), cancellationFeeCents: fee, driverCompensationCents: compensation },
      });
      if (res.count !== 1) throw new HttpException("Conflit, réessayez", 409);
      await tx.dispatchOffer.updateMany({ where: { rideId: ride.id, status: "PENDING" }, data: { status: "CANCELLED" } });
      await tx.rideEvent.create({ data: { rideId: ride.id, type: "booking.cancelled", actor: `partner:${partner.id}`, payload: { feeCents: fee } } });
      await this.webhooks.enqueue(tx, ride.id, "booking.cancelled");
    });
    if (ride.driverId) {
      const msg = cancellationMessage(ride, ride.booking.flightNumber, compensation);
      await this.notif.toDriver(ride.driverId, { type: "RIDE_CANCELLED", ...msg, data: { rideId: ride.id, ref: ride.ref, compensationCents: compensation } }, { email: true });
    }
    return { status: "CANCELLED_BY_PARTNER", cancellationFee: euros(fee) };
  }
}
