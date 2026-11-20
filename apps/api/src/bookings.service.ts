import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Partner } from "@prisma/client";
import { BookingRequest, canTransition } from "@vtc/shared";
import { DispatchService } from "./dispatch.service";
import { euros } from "./http";
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

@Injectable()
export class BookingsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(DispatchService) private dispatch: DispatchService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
  ) {}

  private async findForPartner(partner: Partner, bookingId: string): Promise<RideFull> {
    const ride = await this.prisma.ride.findFirst({ where: { bookingId, booking: { partnerId: partner.id } }, include });
    if (!ride) throw new HttpException("Réservation introuvable", 404);
    return ride;
  }

  async get(partner: Partner, bookingId: string) {
    return bookingView(await this.findForPartner(partner, bookingId));
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
            passengerPhone: req.passenger.phone, passengerEmail: req.passenger.email,
            passengerLanguage: req.passenger.language, flightNumber: r.flightNumber,
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
            driverNetCents: quote.driverNetCents, flatRateId: quote.flatRateId,
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
    const ride = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include });
    return { created: true, booking: bookingView(ride) };
  }

  async cancel(partner: Partner, bookingId: string) {
    const ride = await this.findForPartner(partner, bookingId);
    if (!canTransition(ride.status, "CANCELLED_BY_PARTNER")) throw new HttpException(`Annulation impossible (statut ${ride.status})`, 409);
    const fee = cancellationFeeCents(ride.priceCents, ride.pickupAt);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.ride.updateMany({
        where: { id: ride.id, status: ride.status },
        data: { status: "CANCELLED_BY_PARTNER", version: { increment: 1 } },
      });
      if (res.count !== 1) throw new HttpException("Conflit, réessayez", 409);
      await tx.dispatchOffer.updateMany({ where: { rideId: ride.id, status: "PENDING" }, data: { status: "CANCELLED" } });
      await tx.rideEvent.create({ data: { rideId: ride.id, type: "booking.cancelled", actor: `partner:${partner.id}`, payload: { feeCents: fee } } });
      await this.webhooks.enqueue(tx, ride.id, "booking.cancelled");
    });
    return { status: "CANCELLED_BY_PARTNER", cancellationFee: euros(fee) };
  }
}
