import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { flightMessage } from "./messages";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";
import { WebhooksService } from "./webhooks.service";

export type FlightStatus = "SCHEDULED" | "DELAYED" | "EARLY" | "LANDED" | "CANCELLED";
export const DELAYED_FROM_MIN = 15;
export const EARLY_FROM_MIN = 10; // en dessous, l'avance est négligeable : on reste « à l'heure »

/** Branchement d'un fournisseur de données de vol (AeroDataBox, FlightAware…). Aucun n'est configuré par défaut. */
export interface FlightProvider {
  lookup(flightNumber: string, around: Date): Promise<{ estimatedArrivalAt: Date | null; status?: FlightStatus } | null>;
}

const OPEN = ["DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED"] as const;

@Injectable()
export class FlightsService {
  private log = new Logger("flights");
  provider: FlightProvider | null = null;
  private lastPoll = 0;
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  /**
   * Met à jour l'heure d'arrivée estimée d'un vol. Le retard est mesuré par rapport à l'atterrissage prévu,
   * soit `pickupAt` moins le délai d'atterrissage → prise en charge (`flightBufferMin`). Notifie le partenaire (webhook flight.delayed) et le chauffeur si le retard change.
   */
  async update(rideId: string, input: { estimatedArrivalAt?: Date | null; status?: FlightStatus }, actor: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, include: { booking: true } });
    if (!ride) throw new HttpException("Course introuvable", 404);
    if (!ride.booking.flightNumber) throw new HttpException("Cette réservation n'a pas de numéro de vol", 409);
    if (!(OPEN as readonly string[]).includes(ride.status)) throw new HttpException(`Mise à jour impossible (statut ${ride.status})`, 409);

    const hasEst = "estimatedArrivalAt" in input;
    const est = hasEst ? input.estimatedArrivalAt ?? null : ride.flightEstimatedAt;
    const scheduledLanding = ride.pickupAt.getTime() - ride.flightBufferMin * 60_000;
    const delay = hasEst ? (est ? Math.max(0, Math.round((est.getTime() - scheduledLanding) / 60_000)) : 0) : ride.flightDelayMin;
    const rawEarly = hasEst ? (est ? Math.max(0, Math.round((scheduledLanding - est.getTime()) / 60_000)) : 0) : ride.flightEarlyMin;
    const early = rawEarly >= EARLY_FROM_MIN ? rawEarly : 0; // une avance de quelques minutes n'est ni affichée ni notifiée
    // Un vol posé ou annulé le reste : une estimation tardive du fournisseur ne le « ressuscite » pas.
    const sticky = ride.flightStatus === "LANDED" || ride.flightStatus === "CANCELLED" ? (ride.flightStatus as FlightStatus) : undefined;
    const derived: FlightStatus = delay >= DELAYED_FROM_MIN ? "DELAYED" : early >= EARLY_FROM_MIN ? "EARLY" : "SCHEDULED";
    const status: FlightStatus = input.status ?? sticky ?? derived;
    const previous = (ride.flightStatus ?? "SCHEDULED") as FlightStatus;
    const delayChanged = delay !== ride.flightDelayMin;
    const earlyChanged = early !== ride.flightEarlyMin;
    const statusChanged = status !== previous;
    if (!delayChanged && !earlyChanged && !statusChanged && est?.getTime() === ride.flightEstimatedAt?.getTime()) return { changed: false, delayMin: delay };

    await this.prisma.$transaction(async (tx) => {
      await tx.ride.update({ where: { id: rideId }, data: { flightDelayMin: delay, flightEarlyMin: early, flightEstimatedAt: est, flightStatus: status } });
      await tx.rideEvent.create({ data: { rideId, type: "flight.updated", actor, payload: { delayMin: delay, earlyMin: early, status, estimatedArrivalAt: est } as any } });
      if (statusChanged && status === "CANCELLED") await tx.rideEvent.create({ data: { rideId, type: "flight.cancelled", actor } });
      // flight.delayed est conservé pour la compatibilité ; flight.updated couvre tous les changements d'état (retard, avance, atterri, annulé).
      if (delayChanged) await this.webhooks.enqueue(tx, rideId, "flight.delayed");
      if (delayChanged || earlyChanged || statusChanged) await this.webhooks.enqueue(tx, rideId, "flight.updated");
    });
    // Le chauffeur est prévenu à chaque changement significatif (message dans l'application, relais e-mail pour une annulation).
    if ((delayChanged || earlyChanged || statusChanged) && ride.driverId) {
      const m = flightMessage({
        flightNumber: ride.booking.flightNumber, status, delayMin: delay, earlyMin: early, estimatedArrivalAt: est,
        scheduledLanding: new Date(scheduledLanding), pickupAt: ride.pickupAt, bufferMin: ride.flightBufferMin,
      });
      await this.notif.toDriver(ride.driverId, { ...m, data: { rideId, delayMin: delay, earlyMin: early, status } }, { email: status === "CANCELLED" });
    }
    return { changed: true, delayMin: delay, earlyMin: early, status };
  }

  /** Interroge le fournisseur (si configuré) pour les missions à venir avec un vol. Limité à 1 passage par minute. */
  async poll(now = new Date()): Promise<number> {
    if (!this.provider || now.getTime() - this.lastPoll < 60_000) return 0;
    this.lastPoll = now.getTime();
    const rides = await this.prisma.ride.findMany({
      where: {
        status: { in: [...OPEN] }, booking: { flightNumber: { not: null } },
        pickupAt: { gte: new Date(now.getTime() - 3 * 3600_000), lte: new Date(now.getTime() + 12 * 3600_000) },
      },
      include: { booking: true },
    });
    let n = 0;
    for (const r of rides) {
      try {
        const info = await this.provider.lookup(r.booking.flightNumber!, r.pickupAt);
        if (!info) continue;
        const res = await this.update(r.id, { estimatedArrivalAt: info.estimatedArrivalAt, status: info.status }, "provider");
        if (res.changed) n++;
      } catch (e: any) {
        this.log.warn(`vol ${r.booking.flightNumber} : ${e?.message ?? e}`);
      }
    }
    return n;
  }
}
