import { Body, Controller, Delete, Get, HttpException, Inject, Injectable, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ecoBonusCents } from "./eco";
import { parse } from "./http";
import { effectivePickup } from "./metrics";
import { NotificationsService } from "./notifications";
import { PrismaService } from "./prisma";
import { CompanyGuard } from "./security";
import { SwapService } from "./swap";
import { firstCompliant } from "./vehicle-rules";
import { WebhooksService } from "./webhooks.service";

/**
 * Mise en commun entre sociétés. Pourquoi : une société débordée ne rend pas la mission au dispatch (pénalité, incertitude) ;
 * elle la confie directement à une société partenaire volontaire, avec une règle de partage annoncée AVANT l'acceptation.
 * Valeurs de départ, à confirmer : délai minimal 24 h avant la prise en charge, part reversée à la société d'origine 0 %.
 */
export function poolConfig(env: NodeJS.ProcessEnv = process.env) {
  const num = (k: string, d: number, max: number) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 && v <= max ? v : d; };
  return { minHours: num("POOL_MIN_HOURS", 24, 24 * 30), sharePercent: Math.round(num("POOL_SHARE_PERCENT", 0, 50)) };
}

/** Part reversée à la société d'origine, prise sur le net de base de la mission (hors prime électrique). */
export const poolShareCents = (baseNetCents: number, percent: number) => Math.max(0, Math.round((baseNetCents * percent) / 100));

@Injectable()
export class PoolService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(SwapService) private swap: SwapService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(NotificationsService) private notif: NotificationsService,
  ) {}

  private open(pickup: Date, now: Date) { return pickup.getTime() - now.getTime() >= poolConfig().minHours * 3600_000; }

  async setOptIn(companyId: string, enabled: boolean) {
    await this.prisma.company.update({ where: { id: companyId }, data: { poolOptIn: enabled } });
    if (!enabled) await this.prisma.ridePool.updateMany({ where: { fromCompanyId: companyId, status: "OPEN" }, data: { status: "CANCELLED" } });
    return { optIn: enabled };
  }

  async give(companyId: string, rideId: string, now = new Date()) {
    const co = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (!co.poolOptIn) throw new HttpException("Activez d'abord la mise en commun (elle est réciproque)", 409);
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, include: { driver: true } });
    if (!ride || ride.driver?.companyId !== companyId) throw new HttpException("Mission introuvable", 404);
    if (ride.status !== "ASSIGNED") throw new HttpException("Seule une mission acceptée et pas encore commencée peut être confiée", 409);
    if (!this.open(effectivePickup(ride.pickupAt, ride.flightDelayMin), now)) throw new HttpException(`Possible jusqu'à ${poolConfig().minHours} h avant la prise en charge`, 409);
    if (await this.prisma.ridePool.count({ where: { rideId, status: "OPEN" } })) throw new HttpException("Mission déjà confiée, en attente d'une société", 409);
    const p = await this.prisma.ridePool.create({ data: { rideId, fromCompanyId: companyId, fromDriverId: ride.driverId!, sharePercent: poolConfig().sharePercent } });
    await this.prisma.rideEvent.create({ data: { rideId, type: "pool.offered", actor: `company:${companyId}` } });
    return { id: p.id, sharePercent: p.sharePercent };
  }

  async cancel(companyId: string, id: string) {
    const r = await this.prisma.ridePool.updateMany({ where: { id, fromCompanyId: companyId, status: "OPEN" }, data: { status: "CANCELLED" } });
    if (r.count !== 1) throw new HttpException("Proposition introuvable ou déjà reprise", 404);
    return { ok: true };
  }

  /** Ce que voit une société : ses propositions, et celles des autres qu'elle peut prendre (avec SES chauffeurs éligibles). */
  async board(companyId: string, now = new Date()) {
    const co = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const view = (p: any) => ({
      id: p.id, status: p.status, sharePercent: p.sharePercent, shareCents: p.shareCents, createdAt: p.createdAt, takenAt: p.takenAt,
      ride: { id: p.ride.id, ref: p.ride.ref, pickupAt: p.ride.pickupAt, pickup: p.ride.pickupAddress, dropoff: p.ride.dropoffAddress, category: p.ride.category, needs: p.ride.needs, distanceKm: p.ride.distanceKm, durationMin: p.ride.durationMin, baseNetCents: p.ride.driverNetCents - p.ride.ecoBonusCents },
    });
    const mine = await this.prisma.ridePool.findMany({ where: { fromCompanyId: companyId }, include: { ride: true, toCompany: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
    const out = { optIn: co.poolOptIn, sharePercent: poolConfig().sharePercent, minHours: poolConfig().minHours, given: mine.map((p) => ({ ...view(p), toCompany: p.toCompany?.name ?? null })), available: [] as any[] };
    if (!co.poolOptIn) return out;
    const offers = await this.prisma.ridePool.findMany({ where: { status: "OPEN", fromCompanyId: { not: companyId }, fromCompany: { poolOptIn: true, active: true } }, include: { ride: true, fromCompany: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 50 });
    const drivers = await this.prisma.driver.findMany({ where: { companyId, status: "ACTIVE" }, include: { vehicles: { where: { active: true } } } });
    for (const p of offers) {
      if (p.ride.status !== "ASSIGNED" || !this.open(effectivePickup(p.ride.pickupAt, p.ride.flightDelayMin), now)) continue;
      const ok = [];
      for (const d of drivers) if (await this.swap.eligible(this.prisma, d.id, d.vehicles, p.ride, now)) ok.push({ id: d.id, name: `${d.firstName} ${d.lastName}` });
      const base = p.ride.driverNetCents - p.ride.ecoBonusCents;
      out.available.push({ ...view(p), fromCompany: p.fromCompany.name, shareCents: poolShareCents(base, p.sharePercent), drivers: ok });
    }
    return out;
  }

  async take(companyId: string, id: string, driverId: string, now = new Date()) {
    let info: { fromDriver: string; ref: number; rideId: string } | null = null;
    await this.prisma.$transaction(async (tx) => {
      const co = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      if (!co.poolOptIn) throw new HttpException("Activez d'abord la mise en commun", 409);
      const p = await tx.ridePool.findUnique({ where: { id }, include: { ride: true } });
      if (!p || p.status !== "OPEN" || p.fromCompanyId === companyId) throw new HttpException("Proposition plus disponible", 409);
      const ride = p.ride;
      if (ride.status !== "ASSIGNED" || ride.driverId !== p.fromDriverId) throw new HttpException("La mission a changé entre-temps", 409);
      if (!this.open(effectivePickup(ride.pickupAt, ride.flightDelayMin), now)) throw new HttpException(`Possible jusqu'à ${poolConfig().minHours} h avant la prise en charge`, 409);
      const d = await tx.driver.findFirst({ where: { id: driverId, companyId, status: "ACTIVE" }, include: { vehicles: { where: { active: true, category: ride.category } } } });
      if (!d) throw new HttpException("Chauffeur introuvable ou non actif", 404);
      const vehicle = firstCompliant(d.vehicles, ride.category, ride.needs);
      if (!vehicle || !(await this.swap.eligible(tx, driverId, d.vehicles, ride, now))) throw new HttpException("Ce chauffeur ne peut pas faire cette mission (véhicule, planning ou repos)", 409);
      const base = ride.driverNetCents - ride.ecoBonusCents;
      const share = poolShareCents(base, p.sharePercent);
      const eco = ecoBonusCents(vehicle.fuel, ride.priceCents, ride.priceCents - base);
      const moved = await tx.ride.updateMany({
        where: { id: ride.id, status: "ASSIGNED", driverId: p.fromDriverId },
        data: { driverId, vehicleId: vehicle.id, swapOfferedAt: null, driverNetCents: base - share + eco, ecoBonusCents: eco, commissionCents: ride.priceCents - base - eco, version: { increment: 1 } },
      });
      if (moved.count !== 1) throw new HttpException("La mission a changé entre-temps", 409);
      const done = await tx.ridePool.updateMany({ where: { id, status: "OPEN" }, data: { status: "TAKEN", toCompanyId: companyId, toDriverId: driverId, shareCents: share, takenAt: now } });
      if (done.count !== 1) throw new HttpException("Proposition plus disponible", 409);
      await tx.rideEvent.create({ data: { rideId: ride.id, type: "pool.taken", actor: `company:${companyId}`, payload: { from: p.fromCompanyId, to: companyId, driverId, shareCents: share } } });
      await this.webhooks.enqueue(tx, ride.id, "driver.assigned");
      info = { fromDriver: p.fromDriverId, ref: ride.ref, rideId: ride.id };
    });
    const i = info!;
    await this.notif.toDriver(i.fromDriver, { type: "POOL_TAKEN", title: "Mission confiée", body: `Votre société a confié la mission R-${i.ref} à une société partenaire. Elle n'est plus dans votre planning, sans pénalité.`, data: { rideId: i.rideId, ref: i.ref } });
    await this.notif.toDriver(driverId, { type: "ASSIGNED_BY_COMPANY", title: "Nouvelle mission", body: `Votre société vous a attribué la mission R-${i.ref}.`, data: { rideId: i.rideId, ref: i.ref } }, { email: true });
    return { ok: true, ref: i.ref };
  }
}

@Controller("company/pool")
@UseGuards(CompanyGuard)
export class CompanyPoolController {
  constructor(@Inject(PoolService) private svc: PoolService) {}
  @Get() board(@Req() req: any) { return this.svc.board(req.company.id); }
  @Post("opt-in") optIn(@Req() req: any, @Body() body: unknown) { return this.svc.setOptIn(req.company.id, parse(z.object({ enabled: z.boolean() }), body).enabled); }
  @Post() give(@Req() req: any, @Body() body: unknown) { return this.svc.give(req.company.id, parse(z.object({ rideId: z.string().uuid() }), body).rideId); }
  @Post(":id/take") take(@Req() req: any, @Param("id") id: string, @Body() body: unknown) { return this.svc.take(req.company.id, id, parse(z.object({ driverId: z.string().uuid() }), body).driverId); }
  @Delete(":id") cancel(@Req() req: any, @Param("id") id: string) { return this.svc.cancel(req.company.id, id); }
  @Post(":id/cancel") cancelPost(@Req() req: any, @Param("id") id: string) { return this.svc.cancel(req.company.id, id); }
}
