import { HttpException, Inject, Injectable } from "@nestjs/common";
import { Prisma, PenaltyKind } from "@prisma/client";
import { effectivePickup } from "./metrics";
import { money } from "./messages";
import { NotificationsService } from "./notifications";
import { giveBackPenaltyCents, PENALTY, rescuePenaltyCents, Sanction, SANCTION_HOURS, SANCTION_TEXT, sanctionFor, TIERS } from "./penalties";
import { PrismaService } from "./prisma";

type Db = Prisma.TransactionClient | PrismaService;
const WEIGHT: Record<PenaltyKind, number> = { GIVE_BACK: 1, RESCUE: 0.5 };
export const minutesBefore = (ride: { pickupAt: Date; flightDelayMin: number }, now = new Date()) =>
  Math.floor((effectivePickup(ride.pickupAt, ride.flightDelayMin).getTime() - now.getTime()) / 60_000);

export interface Applied { penaltyId: string; amountCents: number; sanction: Sanction; score: number }

@Injectable()
export class PenaltiesService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  /** Score de récidive (restitutions = 1, appels à un sauveteur = 0,5) sur la fenêtre glissante, hors pénalités annulées par l'équipe. */
  async score(db: Db, driverId: string, now = new Date()) {
    const rows = await db.driverPenalty.findMany({ where: { driverId, waivedAt: null, createdAt: { gte: new Date(now.getTime() - PENALTY.windowDays * 86400_000) } }, select: { weight: true } });
    return rows.reduce((s, r) => s + r.weight, 0);
  }

  /** Coût à connaître AVANT de décider : ce que coûterait rendre la mission ou appeler un sauveteur, et la sanction suivante. */
  async quote(driverId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({ where: { id: rideId, driverId } });
    if (!ride) throw new HttpException("Mission introuvable", 404);
    const min = minutesBefore(ride);
    const tier = TIERS.find((t) => min >= t.fromMin)!;
    const score = await this.score(this.prisma, driverId);
    return {
      minutesBefore: min, tier: tier.label,
      giveBackCents: giveBackPenaltyCents(ride.driverNetCents, min),
      rescueCents: rescuePenaltyCents(ride.driverNetCents, min),
      recidivismScore: score,
      sanctionIfGiveBack: sanctionFor(score + WEIGHT.GIVE_BACK),
      sanctionIfRescue: sanctionFor(score + WEIGHT.RESCUE),
    };
  }

  /** Enregistre la pénalité et, en cas de récidive, suspend le compte. À appeler dans la transaction qui libère la mission. */
  async apply(db: Db, driverId: string, ride: { id: string; driverNetCents: number }, kind: PenaltyKind, minutes: number): Promise<Applied> {
    const amountCents = kind === "GIVE_BACK" ? giveBackPenaltyCents(ride.driverNetCents, minutes) : rescuePenaltyCents(ride.driverNetCents, minutes);
    const score = (await this.score(db, driverId)) + WEIGHT[kind];
    const sanction = sanctionFor(score);
    const p = await db.driverPenalty.create({ data: { driverId, rideId: ride.id, kind, amountCents, minutesBefore: minutes, weight: WEIGHT[kind], sanction: sanction === "NONE" ? null : sanction } });
    if (sanction !== "NONE") {
      const hours = SANCTION_HOURS[sanction];
      await db.driver.update({
        where: { id: driverId },
        data: { status: "SUSPENDED", availability: "SUSPENDED", suspendedBy: "auto", suspendedUntil: hours ? new Date(Date.now() + hours * 3600_000) : null },
      });
    }
    return { penaltyId: p.id, amountCents, sanction, score };
  }

  /** Message au chauffeur : montant, motif, sanction éventuelle. Ne lève jamais. */
  async tell(driverId: string, ref: number, kind: PenaltyKind, a: Applied) {
    const lines = [
      kind === "GIVE_BACK" ? `Vous avez rendu la mission R-${ref}.` : `Un sauveteur a repris votre mission R-${ref}.`,
      `Pénalité : ${money(a.amountCents)}, déduite de votre prochain relevé.`,
      "Plus l'annulation est proche de la prise en charge, plus la pénalité est élevée : prévenez tôt.",
    ];
    if (a.sanction !== "NONE") lines.push("", SANCTION_TEXT[a.sanction], "Vous pouvez contester auprès du support, justificatif à l'appui (accident, urgence médicale).");
    await this.notif.toDriver(driverId, { type: "PENALTY", title: `Pénalité · R-${ref}`, body: lines.join("\n"), data: { amountCents: a.amountCents, sanction: a.sanction } }, { email: true });
  }

  /** Lève les suspensions automatiques arrivées à terme (celles sans échéance restent à la décision de l'équipe). */
  async sweep(now = new Date()) {
    const due = await this.prisma.driver.findMany({ where: { status: "SUSPENDED", suspendedBy: "auto", suspendedUntil: { lte: now } }, select: { id: true } });
    for (const d of due) {
      const r = await this.prisma.driver.updateMany({ where: { id: d.id, status: "SUSPENDED", suspendedBy: "auto", suspendedUntil: { lte: now } }, data: { status: "ACTIVE", suspendedBy: null, suspendedUntil: null } });
      if (r.count === 1) await this.notif.toDriver(d.id, { type: "SUSPENSION_ENDED", title: "Suspension terminée", body: "Votre compte est de nouveau actif. Vous pouvez vous remettre en ligne. Une nouvelle restitution tardive aggraverait la sanction." });
    }
  }

  // ---- administration ----
  async adminList(driverId?: string) {
    const rows = await this.prisma.driverPenalty.findMany({ where: driverId ? { driverId } : {}, include: { driver: true }, orderBy: { createdAt: "desc" }, take: 100 });
    const rides = await this.prisma.ride.findMany({ where: { id: { in: rows.map((r) => r.rideId) } }, select: { id: true, ref: true } });
    const ref = new Map(rides.map((r) => [r.id, r.ref]));
    return rows.map((r) => ({
      id: r.id, driverId: r.driverId, driver: `${r.driver.firstName} ${r.driver.lastName}`, ref: ref.get(r.rideId), kind: r.kind, amountCents: r.amountCents,
      minutesBefore: r.minutesBefore, sanction: r.sanction, waived: !!r.waivedAt, waiveReason: r.waiveReason, createdAt: r.createdAt,
    }));
  }

  /** Dérogation justifiée (accident, urgence médicale…) : la pénalité n'est plus due et ne compte plus dans la récidive. */
  async waive(id: string, reason: string, actor: string) {
    const r = await this.prisma.driverPenalty.updateMany({ where: { id, waivedAt: null }, data: { waivedAt: new Date(), waivedBy: actor, waiveReason: reason } });
    if (r.count !== 1) throw new HttpException("Pénalité introuvable ou déjà annulée", 404);
    const p = await this.prisma.driverPenalty.findUniqueOrThrow({ where: { id } });
    await this.notif.toDriver(p.driverId, { type: "PENALTY_WAIVED", title: "Pénalité annulée", body: `Votre pénalité de ${money(p.amountCents)} est annulée par l'équipe (${reason}).` });
    return { ok: true };
  }
}
