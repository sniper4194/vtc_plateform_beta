import { HttpException, Inject, Injectable } from "@nestjs/common";
import { effectivePickup } from "./metrics";
import { acceptanceMessage } from "./messages";
import { DispatchService } from "./dispatch.service";
import { NotificationsService } from "./notifications";
import { minutesBefore, PenaltiesService } from "./penalties.service";
import { PrismaService } from "./prisma";
import { currentWave, eliteCheck, openTo, planWaveSeconds, RESCUABLE, RESCUE, rescueAcceptedToRequester, rescueBonusCents, rescueExpiredToRequester, rescueRequestMessage } from "./rescue";
import { firstCompliant } from "./vehicle-rules";
import { haversineKm } from "./zones";
import { assertAirportBadge } from "./airport-badge";
import { assertCardTerminal } from "./card-terminal";
import { WebhooksService } from "./webhooks.service";

const initials = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName.charAt(0)}.`;

@Injectable()
export class RescueService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(DispatchService) private dispatch: DispatchService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(NotificationsService) private notif: NotificationsService,
    @Inject(PenaltiesService) private penalties: PenaltiesService,
  ) {}

  private async completed(driverIds: string[]) {
    const rows = await this.prisma.ride.groupBy({ by: ["driverId"], where: { driverId: { in: driverIds }, status: "COMPLETED" }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.driverId as string, r._count._all]));
  }

  private async check(driverId: string) {
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    const completedRides = (await this.completed([driverId])).get(driverId) ?? 0;
    return { d, completedRides, ...eliteCheck({ ...d, completedRides }) };
  }

  /** Situation du chauffeur : critères, progression, adhésion, appels à l'aide en attente. */
  async status(driverId: string) {
    const c = await this.check(driverId);
    return {
      eligible: c.eligible, listed: c.listed, optIn: c.d.rescueOptIn, revoked: !!c.d.rescueRevokedAt,
      criteria: c.criteria, bonusCents: RESCUE.bonusCents, incoming: (await this.incoming(driverId)).length,
    };
  }

  async setOptIn(driverId: string, enabled: boolean) {
    const c = await this.check(driverId);
    if (enabled && !c.eligible) throw new HttpException({ message: "Critères sauveteur non remplis", criteria: c.criteria }, 403);
    await this.prisma.driver.update({ where: { id: driverId }, data: { rescueOptIn: enabled } });
    return this.status(driverId);
  }

  private async ownRescuable(driverId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({ where: { id: rideId, driverId }, include: { booking: true } });
    if (!ride) throw new HttpException("Mission introuvable", 404);
    if (!(RESCUABLE as readonly string[]).includes(ride.status)) throw new HttpException("Relais impossible : le client est déjà sur place ou à bord", 409);
    return ride;
  }

  /** Sauveteurs disponibles pour cette mission : liste visible, sans coordonnées, triée par proximité du départ. */
  async rescuers(driverId: string, rideId: string) {
    const ride = await this.ownRescuable(driverId, rideId);
    const cands = await this.prisma.driver.findMany({
      where: { id: { not: driverId }, status: "ACTIVE", availability: "AVAILABLE", rescueOptIn: true, rescueRevokedAt: null, vehicles: { some: { active: true, category: ride.category } } },
      include: { vehicles: true },
    });
    const done = await this.completed(cands.map((c) => c.id));
    const out = [];
    for (const c of cands) {
      const completedRides = done.get(c.id) ?? 0;
      if (!eliteCheck({ ...c, completedRides }).listed) continue;
      if (!firstCompliant(c.vehicles, ride.category, ride.needs, c)) continue;
      if (await this.dispatch.hasOverlap(this.prisma, c.id, ride)) continue;
      if (await this.dispatch.fatigueBlocked(this.prisma, c.id, ride)) continue; // garde-fou fatigue
      const km = c.lastLat != null && c.lastLng != null ? haversineKm({ lat: c.lastLat, lng: c.lastLng }, { lat: ride.pickupLat, lng: ride.pickupLng }) : null;
      out.push({ driverId: c.id, name: initials(c), rating: c.rating, completedRides, distanceKm: km == null ? null : Math.round(km * 10) / 10 });
    }
    return out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  }

  async request(driverId: string, rideId: string, input: { targetId?: string; reason: string }) {
    const ride = await this.ownRescuable(driverId, rideId);
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const recent = await this.prisma.rescueRequest.count({ where: { requesterId: driverId, createdAt: { gte: since } } });
    if (recent >= RESCUE.maxOpenPerMonth) throw new HttpException(`Limite de ${RESCUE.maxOpenPerMonth} appels à l'aide par mois atteinte : contactez le support`, 429);
    const list = await this.rescuers(driverId, rideId);
    if (input.targetId && !list.some((r) => r.driverId === input.targetId)) throw new HttpException("Ce sauveteur n'est pas disponible pour cette mission", 409);
    if (!list.length) throw new HttpException("Aucun sauveteur disponible pour le moment", 409);

    const eff = effectivePickup(ride.pickupAt, ride.flightDelayMin).getTime();
    const ttlMin = Math.min(RESCUE.ttlMaxMin, Math.max(2, Math.floor((eff - Date.now()) / 60_000 / 2)));
    const bonusCents = rescueBonusCents(ride.commissionCents);
    // Appel à tous : par vagues, du sauveteur le plus proche du lieu de prise en charge au plus éloigné (`list` est déjà triée par distance ;
    // les chauffeurs dont la position est inconnue passent en dernier).
    const waveSize = RESCUE.waveSize;
    const waveSeconds = input.targetId ? 0 : planWaveSeconds(list.length, ttlMin * 60, waveSize, RESCUE.waveSec);
    const queue = input.targetId ? [] : list.map((r) => r.driverId);
    let req;
    try {
      req = await this.prisma.$transaction(async (tx) => {
        const r = await tx.rescueRequest.create({ data: { rideId, requesterId: driverId, targetId: input.targetId ?? null, reason: input.reason, bonusCents, expiresAt: new Date(Date.now() + ttlMin * 60_000), queue, waveSize, waveSeconds } });
        await this.dispatch.event(tx, rideId, "rescue.requested", `driver:${driverId}`, { requestId: r.id, targetId: r.targetId, reason: input.reason });
        return r;
      });
    } catch (e: any) {
      if (e?.code === "P2002" || /one_open_per_ride/.test(e?.message ?? "")) throw new HttpException("Un appel à l'aide est déjà ouvert pour cette mission", 409);
      throw e;
    }
    const me = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    const msg = rescueRequestMessage(ride, ride.booking.flightNumber, initials(me), input.reason, bonusCents, !!input.targetId);
    const recipients = input.targetId ? [input.targetId] : waveSeconds > 0 ? queue.slice(0, waveSize) : queue; // vague 1 seulement ; les suivantes partent au balayage
    for (const id of recipients) await this.notif.toDriver(id, { type: "RESCUE_REQUEST", ...msg, data: { rescueId: req.id, rideId } });
    return { id: req.id, expiresAt: req.expiresAt, bonusCents, notified: recipients.length, candidates: list.length, waveSeconds };
  }

  async cancel(driverId: string, id: string) {
    const r = await this.prisma.rescueRequest.updateMany({ where: { id, requesterId: driverId, status: "OPEN" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    if (r.count !== 1) throw new HttpException("Appel introuvable ou déjà traité", 404);
    return { status: "CANCELLED" };
  }

  /** Appels de l'utilisateur lui-même (suivi du statut côté demandeur). */
  async mine(driverId: string) {
    const rows = await this.prisma.rescueRequest.findMany({ where: { requesterId: driverId }, include: { ride: true, rescuer: true, target: true }, orderBy: { createdAt: "desc" }, take: 20 });
    return rows.map((r) => ({
      id: r.id, rideId: r.rideId, ref: r.ride.ref, status: r.status, reason: r.reason, expiresAt: r.expiresAt, createdAt: r.createdAt,
      target: r.target ? initials(r.target) : null, rescuer: r.rescuer ? initials(r.rescuer) : null,
    }));
  }

  /** Appels reçus : ciblés sur moi, ou diffusés si je suis sauveteur listé. Le passager n'est jamais divulgué. */
  async incoming(driverId: string) {
    const c = await this.check(driverId);
    const rows = await this.prisma.rescueRequest.findMany({
      where: { status: "OPEN", expiresAt: { gt: new Date() }, requesterId: { not: driverId }, OR: [{ targetId: driverId }, ...(c.listed ? [{ targetId: null }] : [])] },
      include: { ride: true, requester: true }, orderBy: { expiresAt: "asc" },
    });
    const now = new Date();
    // Plusieurs appels ouverts : le plus proche de ma position (jusqu'au lieu de prise en charge) en premier, puis le plus pressé.
    const me = c.d.lastLat != null && c.d.lastLng != null ? { lat: c.d.lastLat, lng: c.d.lastLng } : null;
    const km = (r: (typeof rows)[number]) => (me ? haversineKm(me, { lat: r.ride.pickupLat, lng: r.ride.pickupLng }) : null);
    return rows
      .filter((r) => r.targetId === driverId || openTo(r, driverId, now))
      .map((r) => ({ r, away: km(r) }))
      .sort((a, b) => (a.away ?? 1e9) - (b.away ?? 1e9) || a.r.expiresAt.getTime() - b.r.expiresAt.getTime())
      .map(({ r, away }) => ({
        id: r.id, direct: r.targetId === driverId, requester: initials(r.requester), reason: r.reason, expiresAt: r.expiresAt,
        secondsLeft: Math.max(0, Math.round((r.expiresAt.getTime() - Date.now()) / 1000)),
        pickupAt: r.ride.pickupAt, category: r.ride.category, pickup: r.ride.pickupAddress, dropoff: r.ride.dropoffAddress,
        distanceKm: Math.round(r.ride.distanceKm * 10) / 10, durationMin: Math.round(r.ride.durationMin),
        netCents: r.ride.driverNetCents + r.bonusCents, bonusCents: r.bonusCents,
        awayKm: away == null ? null : Math.round(away * 10) / 10, // distance entre moi et le lieu de prise en charge
      }));
  }

  async decline(driverId: string, id: string) {
    const r = await this.prisma.rescueRequest.findUnique({ where: { id }, include: { ride: true } });
    if (!r || r.status !== "OPEN") throw new HttpException("Appel introuvable ou déjà traité", 404);
    if (r.targetId !== driverId) return { status: "IGNORED" }; // diffusion : décliner revient à ignorer
    await this.prisma.rescueRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "DECLINED", resolvedAt: new Date() } });
    await this.notif.toDriver(r.requesterId, { type: "RESCUE_DECLINED", title: `Sauveteur indisponible · R-${r.ride.ref}`, body: "Le sauveteur choisi ne peut pas reprendre la mission. Choisissez-en un autre ou lancez un appel à tous les sauveteurs.", data: { rideId: r.rideId } });
    return { status: "DECLINED" };
  }

  /** Reprise atomique : la mission change de chauffeur en une seule transaction, ou ne change pas. */
  async accept(driverId: string, id: string) {
    let rideId = "", requesterId = "";
    let applied: Awaited<ReturnType<PenaltiesService["apply"]>> | null = null;
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.rescueRequest.findUnique({ where: { id }, include: { ride: true } });
      if (!r) throw new HttpException("Appel introuvable", 404);
      if (r.status !== "OPEN" || r.expiresAt <= new Date()) throw new HttpException("Appel expiré ou déjà pris en charge", 409);
      if (r.targetId && r.targetId !== driverId) throw new HttpException("Appel adressé à un autre sauveteur", 403);
      if (!r.targetId && !openTo(r, driverId, new Date())) throw new HttpException("Cet appel n'est pas encore ouvert à votre position : il passe d'abord par les sauveteurs les plus proches", 403);
      if (r.requesterId === driverId) throw new HttpException("Vous ne pouvez pas reprendre votre propre mission", 403);
      const d = await tx.driver.findUniqueOrThrow({ where: { id: driverId } });
      const completedRides = await tx.ride.count({ where: { driverId, status: "COMPLETED" } });
      if (!eliteCheck({ ...d, completedRides }).listed) throw new HttpException("Réservé aux sauveteurs", 403);
      const vehicle = firstCompliant(await tx.vehicle.findMany({ where: { driverId, active: true, category: r.ride.category } }), r.ride.category, r.ride.needs, d);
      if (!vehicle) throw new HttpException("Aucun véhicule compatible et conforme", 409);
      await assertAirportBadge(tx, driverId, r.ride);
      await assertCardTerminal(tx, driverId, r.ride);
      if (await this.dispatch.hasOverlap(tx, driverId, r.ride)) throw new HttpException("Conflit avec une autre course de votre planning", 409);
      if (await this.dispatch.fatigueBlocked(tx, driverId, r.ride)) throw new HttpException("Repos nécessaire : cette mission vous ferait dépasser le maximum d'heures de mission sur 24 h", 409);
      const claimed = await tx.rescueRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "ACCEPTED", rescuerId: driverId, resolvedAt: new Date() } });
      if (claimed.count !== 1) throw new HttpException("Appel déjà pris en charge", 409);
      const moved = await tx.ride.updateMany({
        where: { id: r.rideId, driverId: r.requesterId, status: { in: [...RESCUABLE] } },
        data: { status: "ASSIGNED", driverId, vehicleId: vehicle.id, swapOfferedAt: null, version: { increment: 1 }, driverNetCents: r.ride.driverNetCents + r.bonusCents, commissionCents: r.ride.commissionCents - r.bonusCents },
      });
      if (moved.count !== 1) throw new HttpException("La mission a changé entre-temps", 409);
      // Le délai se mesure à la DEMANDE (moment où le chauffeur a su qu'il ne pourrait pas), pas à l'acceptation : attendre ne réduit pas la pénalité.
      applied = await this.penalties.apply(tx, r.requesterId, r.ride, "RESCUE", minutesBefore(r.ride, r.createdAt));
      await this.dispatch.event(tx, r.rideId, "ride.rescued", `driver:${driverId}`, { requestId: id, from: r.requesterId, to: driverId, bonusCents: r.bonusCents });
      await this.webhooks.enqueue(tx, r.rideId, "driver.assigned");
      rideId = r.rideId; requesterId = r.requesterId;
    });
    const ride = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: { booking: true } });
    const rescuer = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    await this.notif.toDriver(driverId, { type: "RIDE_ACCEPTED", ...acceptanceMessage(ride, ride.booking.flightNumber, false), data: { rideId, ref: ride.ref } }, { email: true });
    await this.notif.toDriver(requesterId, { type: "RESCUE_ACCEPTED", ...rescueAcceptedToRequester(ride.ref, ride.pickupAt, initials(rescuer)), data: { rideId } });
    if (applied) await this.penalties.tell(requesterId, ride.ref, "RESCUE", applied);
    return { status: "ASSIGNED", rideId };
  }

  /** Expire les appels sans réponse (et annule ceux dont la mission a changé de main), puis prévient le demandeur. */
  async sweep(now = new Date()) {
    const stale = await this.prisma.rescueRequest.findMany({ where: { status: "OPEN" }, include: { ride: { include: { booking: true } }, requester: true } });
    for (const r of stale) {
      const moved = r.ride.driverId !== r.requesterId || !(RESCUABLE as readonly string[]).includes(r.ride.status);
      // Diffusion par vagues : on prévient la vague suivante de sauveteurs (du plus proche au plus éloigné) quand son tour est venu.
      if (!moved && r.expiresAt > now && !r.targetId && r.waveSeconds > 0) {
        const wave = currentWave(r, now);
        if (wave > r.notifiedWave) {
          const claimed = await this.prisma.rescueRequest.updateMany({ where: { id: r.id, status: "OPEN", notifiedWave: r.notifiedWave }, data: { notifiedWave: wave } });
          if (claimed.count === 1) {
            const msg = rescueRequestMessage(r.ride, r.ride.booking.flightNumber, initials(r.requester), r.reason, r.bonusCents, false);
            for (const id of r.queue.slice((r.notifiedWave + 1) * r.waveSize, (wave + 1) * r.waveSize)) await this.notif.toDriver(id, { type: "RESCUE_REQUEST", ...msg, data: { rescueId: r.id, rideId: r.rideId } });
          }
        }
      }
      if (!moved && r.expiresAt > now) continue;
      const u = await this.prisma.rescueRequest.updateMany({ where: { id: r.id, status: "OPEN" }, data: { status: moved ? "CANCELLED" : "EXPIRED", resolvedAt: now } });
      if (u.count !== 1 || moved) continue;
      await this.dispatch.event(this.prisma, r.rideId, "rescue.expired", "system", { requestId: r.id });
      await this.notif.toDriver(r.requesterId, { type: "RESCUE_EXPIRED", ...rescueExpiredToRequester(r.ride.ref), data: { rideId: r.rideId } });
    }
  }

  // ---- administration ----
  async adminList(open?: boolean) {
    const rows = await this.prisma.rescueRequest.findMany({
      where: open ? { status: "OPEN" } : {}, include: { ride: true, requester: true, rescuer: true, target: true }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return rows.map((r) => ({
      id: r.id, rideId: r.rideId, ref: r.ride.ref, status: r.status, reason: r.reason, pickupAt: r.ride.pickupAt, pickup: r.ride.pickupAddress,
      requester: `${r.requester.firstName} ${r.requester.lastName}`, rescuer: r.rescuer ? `${r.rescuer.firstName} ${r.rescuer.lastName}` : null,
      direct: !!r.targetId, createdAt: r.createdAt, expiresAt: r.expiresAt,
      // À traiter par l'équipe : appel expiré alors que la mission est toujours chez le demandeur.
      needsAttention: r.status === "EXPIRED" && r.ride.driverId === r.requesterId && r.ride.pickupAt > new Date(),
    }));
  }

  async adminSetRevoked(driverId: string, revoked: boolean, actor: string) {
    const d = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) throw new HttpException("Chauffeur introuvable", 404);
    await this.prisma.driver.update({ where: { id: driverId }, data: { rescueRevokedAt: revoked ? new Date() : null, ...(revoked ? { rescueOptIn: false } : {}) } });
    await this.notif.toDriver(driverId, revoked
      ? { type: "RESCUE_REVOKED", title: "Statut sauveteur retiré", body: "Votre statut de sauveteur a été retiré par l'équipe. Contactez le support pour en connaître la raison." }
      : { type: "RESCUE_RESTORED", title: "Statut sauveteur rétabli", body: "Vous pouvez de nouveau activer votre statut de sauveteur depuis l'onglet Cap." });
    return { ok: true, actor };
  }
}
