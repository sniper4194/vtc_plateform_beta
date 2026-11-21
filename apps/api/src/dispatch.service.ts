import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Prisma, Ride, RideStatus } from "@prisma/client";
import { canTransition } from "@vtc/shared";
import { acceptanceMessage } from "./messages";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";
import { effectivePickup, NO_SHOW_WAIT_MIN } from "./metrics";
import { haversineKm } from "./zones";
import { WEBHOOK_BY_STATUS } from "./views";
import { WebhooksService } from "./webhooks.service";

type Tx = Prisma.TransactionClient;

export const DISPATCH = {
  maxRounds: 3,
  urgentWithinMin: 120,
  urgentTtlSec: 60,
  normalTtlSec: 300,
  retryDelaySec: 60,
  maxOffersPerRound: 20,
  bufferMin: 30, // marge entre deux courses d'un même chauffeur
  noShowWaitMin: NO_SHOW_WAIT_MIN,
};
const ACTIVE: RideStatus[] = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"];

export type DriverAction = "en-route" | "arrived" | "start" | "complete" | "no-show";
const ACTIONS: Record<DriverAction, [RideStatus, RideStatus]> = {
  "en-route": ["ASSIGNED", "EN_ROUTE"],
  arrived: ["EN_ROUTE", "ARRIVED"],
  start: ["ARRIVED", "IN_PROGRESS"],
  complete: ["IN_PROGRESS", "COMPLETED"],
  "no-show": ["ARRIVED", "NO_SHOW"],
};

@Injectable()
export class DispatchService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  // ---------- helpers ----------
  async event(db: Tx | PrismaService, rideId: string, type: string, actor: string, payload?: object) {
    await db.rideEvent.create({ data: { rideId, type, actor, payload: payload as any } });
  }

  private window(r: Pick<Ride, "pickupAt" | "durationMin" | "flightDelayMin">) {
    const start = effectivePickup(r.pickupAt, r.flightDelayMin).getTime();
    return { start, end: start + (r.durationMin + DISPATCH.bufferMin) * 60_000 };
  }

  private async hasOverlap(db: Tx | PrismaService, driverId: string, ride: Ride) {
    const w = this.window(ride);
    const others = await db.ride.findMany({
      where: {
        driverId, status: { in: ACTIVE }, id: { not: ride.id },
        pickupAt: { gte: new Date(w.start - 24 * 3600_000), lte: new Date(w.end + 24 * 3600_000) },
      },
    });
    return others.some((o) => {
      const ow = this.window(o);
      return ow.start < w.end && ow.end > w.start;
    });
  }

  // ---------- démarrage et tours de dispatch ----------
  async start(rideId: string) {
    await this.round(rideId);
  }

  private async roundsDone(rideId: string) {
    const reset = await this.prisma.rideEvent.findFirst({ where: { rideId, type: "dispatch.reset" }, orderBy: { createdAt: "desc" } });
    return this.prisma.rideEvent.count({ where: { rideId, type: "dispatch.round", ...(reset ? { createdAt: { gt: reset.createdAt } } : {}) } });
  }

  async round(rideId: string): Promise<number> {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== "DISPATCHING") return 0;
    const done = await this.roundsDone(rideId);
    if (done >= DISPATCH.maxRounds) return 0;

    // Exclus : ceux qui ont refusé, et ceux qui ont rendu cette mission après l'avoir acceptée.
    const refused = (await this.prisma.dispatchOffer.findMany({ where: { rideId, status: "DECLINED" }, select: { driverId: true } })).map((o) => o.driverId);
    const gaveBack = (await this.prisma.rideEvent.findMany({ where: { rideId, type: "driver.cancelled" }, select: { actor: true } }))
      .map((e) => (e.actor ?? "").replace("driver:", "")).filter(Boolean);
    const declined = [...refused, ...gaveBack];
    const candidates = await this.prisma.driver.findMany({
      where: {
        status: "ACTIVE", availability: "AVAILABLE", id: { notIn: declined },
        vehicles: { some: { active: true, category: ride.category } },
      },
    });
    const eligible: typeof candidates = [];
    for (const d of candidates) if (!(await this.hasOverlap(this.prisma, d.id, ride))) eligible.push(d);
    const dist = (d: (typeof eligible)[number]) =>
      d.lastLat != null && d.lastLng != null ? haversineKm({ lat: d.lastLat, lng: d.lastLng }, { lat: ride.pickupLat, lng: ride.pickupLng }) : Infinity;
    const chosen = eligible.sort((a, b) => dist(a) - dist(b)).slice(0, DISPATCH.maxOffersPerRound);

    const minutesToPickup = (ride.pickupAt.getTime() - Date.now()) / 60_000;
    const ttl = minutesToPickup <= DISPATCH.urgentWithinMin ? DISPATCH.urgentTtlSec : DISPATCH.normalTtlSec;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await this.prisma.$transaction(async (tx) => {
      for (const d of chosen) {
        await tx.dispatchOffer.upsert({
          where: { rideId_driverId: { rideId, driverId: d.id } },
          create: { rideId, driverId: d.id, expiresAt },
          update: { status: "PENDING", expiresAt },
        });
      }
      await this.event(tx, rideId, "dispatch.round", "system", { round: done + 1, offered: chosen.length });
    });
    for (const d of chosen) this.notif.notifyDriver(d.id, `Nouvelle course à prendre (${ride.pickupAddress})`);
    return chosen.length;
  }

  /** À exécuter périodiquement : expire les offres, relance ou signale l'épuisement. */
  async sweep(now = new Date()) {
    await this.prisma.dispatchOffer.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    const stalled = await this.prisma.ride.findMany({
      where: { status: "DISPATCHING", offers: { none: { status: "PENDING" } } },
    });
    for (const ride of stalled) {
      const done = await this.roundsDone(ride.id);
      if (done >= DISPATCH.maxRounds) {
        const flagged = await this.prisma.rideEvent.findFirst({ where: { rideId: ride.id, type: "dispatch.exhausted" } });
        if (!flagged) await this.event(this.prisma, ride.id, "dispatch.exhausted", "system", { rounds: done });
        continue;
      }
      const last = await this.prisma.rideEvent.findFirst({ where: { rideId: ride.id, type: "dispatch.round" }, orderBy: { createdAt: "desc" } });
      if (last && now.getTime() - last.createdAt.getTime() < DISPATCH.retryDelaySec * 1000) continue;
      await this.round(ride.id);
    }
  }

  // ---------- attribution ----------
  private async claim(tx: Tx, ride: Ride, driverId: string, actor: string) {
    const vehicle = await tx.vehicle.findFirst({ where: { driverId, active: true, category: ride.category } });
    if (!vehicle) throw new HttpException("Aucun véhicule compatible", 409);
    if (await this.hasOverlap(tx, driverId, ride)) throw new HttpException("Conflit avec une autre course de votre planning", 409);
    const res = await tx.ride.updateMany({
      where: { id: ride.id, status: "DISPATCHING", driverId: null },
      data: { status: "ASSIGNED", driverId, vehicleId: vehicle.id, version: { increment: 1 } },
    });
    if (res.count !== 1) throw new HttpException("Course déjà attribuée", 409);
    await tx.dispatchOffer.updateMany({ where: { rideId: ride.id, driverId }, data: { status: "ACCEPTED" } });
    await tx.dispatchOffer.updateMany({ where: { rideId: ride.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await this.event(tx, ride.id, "ride.assigned", actor, { driverId });
    await this.webhooks.enqueue(tx, ride.id, "driver.assigned");
  }

  async accept(driverId: string, offerId: string) {
    let rideId = "";
    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.dispatchOffer.findUnique({ where: { id: offerId }, include: { ride: true, driver: true } });
      if (!offer || offer.driverId !== driverId) throw new HttpException("Offre introuvable", 404);
      if (offer.status !== "PENDING" || offer.expiresAt <= new Date()) throw new HttpException("Offre expirée", 409);
      if (offer.driver.status !== "ACTIVE") throw new HttpException("Compte non actif", 403);
      await this.claim(tx, offer.ride, driverId, `driver:${driverId}`);
      rideId = offer.rideId;
    });
    await this.confirmToDriver(driverId, rideId, false);
  }

  /** Confirmation d'acceptation / d'attribution : message dans l'application + e-mail (jamais bloquant). */
  private async confirmToDriver(driverId: string, rideId: string, byDispatch: boolean) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, include: { booking: true } });
    if (!ride) return;
    const msg = acceptanceMessage(ride, ride.booking.flightNumber, byDispatch);
    await this.notif.toDriver(driverId, { type: byDispatch ? "ASSIGNED_BY_DISPATCH" : "RIDE_ACCEPTED", ...msg, data: { rideId, ref: ride.ref } }, { email: true });
  }

  async decline(driverId: string, offerId: string) {
    const res = await this.prisma.dispatchOffer.updateMany({
      where: { id: offerId, driverId, status: "PENDING" }, data: { status: "DECLINED" },
    });
    if (res.count !== 1) throw new HttpException("Offre introuvable ou déjà traitée", 404);
  }

  async adminAssign(rideId: string, driverId: string, admin = "admin") {
    await this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new HttpException("Course introuvable", 404);
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      if (!driver || driver.status !== "ACTIVE") throw new HttpException("Chauffeur non actif", 409);
      await this.claim(tx, ride, driverId, admin);
    });
    await this.confirmToDriver(driverId, rideId, true);
  }

  // ---------- cycle de vie côté chauffeur ----------
  async driverCancel(driverId: string, rideId: string) {
    await this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride || ride.driverId !== driverId) throw new HttpException("Course introuvable", 404);
      if (ride.status !== "ASSIGNED" && ride.status !== "EN_ROUTE") throw new HttpException("Annulation impossible à ce stade", 409);
      const res = await tx.ride.updateMany({
        where: { id: rideId, status: ride.status, driverId },
        data: { status: "DISPATCHING", driverId: null, vehicleId: null, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new HttpException("Conflit, réessayez", 409);
      const d = await tx.driver.findUniqueOrThrow({ where: { id: driverId } });
      await tx.driver.update({ where: { id: driverId }, data: { reliability: Math.max(0, d.reliability - 0.05) } });
      await this.event(tx, rideId, "driver.cancelled", `driver:${driverId}`);
      await this.event(tx, rideId, "dispatch.reset", "system");
    });
    await this.round(rideId);
  }

  async transition(driverId: string, rideId: string, action: DriverAction) {
    const [from, to] = ACTIONS[action];
    await this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride || ride.driverId !== driverId) throw new HttpException("Course introuvable", 404);
      if (ride.status !== from || !canTransition(from, to)) throw new HttpException(`Transition impossible depuis ${ride.status}`, 409);
      if (action === "no-show") {
        const arrived = await tx.rideEvent.findFirst({ where: { rideId, type: "ride.arrived" }, orderBy: { createdAt: "desc" } });
        // Attente comptée à partir de la plus tardive de l'arrivée et de l'heure effective (vol retardé inclus).
        const ref = Math.max(arrived?.createdAt.getTime() ?? Infinity, effectivePickup(ride.pickupAt, ride.flightDelayMin).getTime());
        const allowedAt = ref + DISPATCH.noShowWaitMin * 60_000;
        if (Date.now() < allowedAt) {
          const hm = new Date(allowedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
          throw new HttpException(`Client absent déclarable à partir de ${hm}`, 409);
        }
      }
      const res = await tx.ride.updateMany({ where: { id: rideId, status: from, driverId }, data: { status: to, version: { increment: 1 } } });
      if (res.count !== 1) throw new HttpException("Conflit, réessayez", 409);
      await this.event(tx, rideId, `ride.${to === "ARRIVED" ? "arrived" : to.toLowerCase()}`, `driver:${driverId}`);
      const hook = WEBHOOK_BY_STATUS[to];
      if (hook) await this.webhooks.enqueue(tx, rideId, hook);
    });
  }
}
