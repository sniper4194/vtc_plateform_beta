import { Controller, Get, Inject, Injectable, Query, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "./prisma";
import { AdminGuard, PartnerGuard } from "./security";

/**
 * Bilan carbone par course. Pourquoi : les entreprises clientes doivent mesurer les émissions de leurs déplacements.
 * Règle : AUCUN facteur par défaut. Les facteurs (kgCO2e par km et par véhicule) se relèvent dans la Base Empreinte de l'ADEME
 * et se saisissent dans l'environnement, avec leur source. Tant qu'ils manquent, le bilan est désactivé (null partout) :
 * on ne publie pas un chiffre qui n'a pas été vérifié.
 * Périmètre affiché tel quel : distance PRÉVUE du trajet client (pas le compteur), approche à vide non comptée.
 */
export type Fuel = "THERMAL" | "HYBRID" | "ELECTRIC";
export interface CarbonFactors { THERMAL: number; HYBRID: number; ELECTRIC: number; source: string }

export function carbonFactors(env: NodeJS.ProcessEnv = process.env): CarbonFactors | null {
  const f = (k: string) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v > 0 && v < 5 ? v : null; };
  const t = f("CARBON_FACTOR_THERMAL"), h = f("CARBON_FACTOR_HYBRID"), e = f("CARBON_FACTOR_ELECTRIC");
  const source = (env.CARBON_SOURCE ?? "").trim();
  if (t === null || h === null || e === null || source.length < 5) return null;
  return { THERMAL: t, HYBRID: h, ELECTRIC: e, source };
}

export const CARBON_BASIS = "Distance prévue du trajet client × facteur par véhicule-km ; approche à vide non comptée";

/** Émissions d'une course terminée (kgCO2e, une décimale) ; null si non calculable (facteurs absents, motorisation inconnue, course non terminée). */
export function rideCarbon(r: { status: string; distanceKm: number }, fuel: string | null | undefined, factors: CarbonFactors | null) {
  if (!factors || r.status !== "COMPLETED" || !fuel || !(fuel in { THERMAL: 1, HYBRID: 1, ELECTRIC: 1 })) return null;
  const factor = factors[fuel as Fuel];
  return { kgCO2e: Math.round(r.distanceKm * factor * 10) / 10, distanceKm: Math.round(r.distanceKm * 10) / 10, fuel, factorKgPerKm: factor, basis: CARBON_BASIS, source: factors.source };
}

@Injectable()
export class CarbonService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  /** Bilan sur une période : total, par motorisation, et courses non calculables (motorisation inconnue). */
  async summary(input: { from: Date; to: Date; partnerId?: string }) {
    const factors = carbonFactors();
    if (!factors) return { enabled: false, reason: "Facteurs d'émission non renseignés (CARBON_FACTOR_* et CARBON_SOURCE)." };
    const rides = await this.prisma.ride.findMany({
      where: { status: "COMPLETED", pickupAt: { gte: input.from, lt: input.to }, ...(input.partnerId ? { booking: { partnerId: input.partnerId } } : {}) },
      select: { id: true, ref: true, status: true, distanceKm: true, pickupAt: true, vehicle: { select: { fuel: true } } },
      orderBy: { pickupAt: "asc" },
    });
    const byFuel: Record<string, { rides: number; km: number; kgCO2e: number }> = {};
    let total = 0, km = 0, unknown = 0;
    const lines = [];
    for (const r of rides) {
      const c = rideCarbon(r, r.vehicle?.fuel, factors);
      if (!c) { unknown++; continue; }
      const b = (byFuel[c.fuel] ??= { rides: 0, km: 0, kgCO2e: 0 });
      b.rides++; b.km += c.distanceKm; b.kgCO2e += c.kgCO2e; total += c.kgCO2e; km += c.distanceKm;
      lines.push({ reference: `R-${r.ref}`, pickupAt: r.pickupAt, ...c });
    }
    const round = (x: number) => Math.round(x * 10) / 10;
    for (const b of Object.values(byFuel)) { b.km = round(b.km); b.kgCO2e = round(b.kgCO2e); }
    return {
      enabled: true, from: input.from, to: input.to, rides: lines.length, km: round(km), kgCO2e: round(total),
      unknownFuelRides: unknown, byFuel, factors: { THERMAL: factors.THERMAL, HYBRID: factors.HYBRID, ELECTRIC: factors.ELECTRIC, unit: "kgCO2e/véhicule-km" },
      source: factors.source, basis: CARBON_BASIS, lines,
    };
  }
}

/** Période : `from` et `to` (dates ISO) ; par défaut les 30 derniers jours, au plus 366 jours. */
export function period(from?: string, to?: string, now = new Date()) {
  const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : now;
  let start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - 30 * 86400_000);
  if (end.getTime() - start.getTime() > 366 * 86400_000) start = new Date(end.getTime() - 366 * 86400_000);
  return { from: start, to: end };
}

@Controller("v1/carbon")
@UseGuards(PartnerGuard)
export class PartnerCarbonController {
  constructor(@Inject(CarbonService) private svc: CarbonService) {}
  @Get() get(@Req() req: any, @Query("from") from?: string, @Query("to") to?: string) { return this.svc.summary({ ...period(from, to), partnerId: req.partner.id }); }
}

@Controller("admin/carbon")
@UseGuards(AdminGuard)
export class AdminCarbonController {
  constructor(@Inject(CarbonService) private svc: CarbonService) {}
  @Get() get(@Query("from") from?: string, @Query("to") to?: string, @Query("partnerId") partnerId?: string) {
    return this.svc.summary({ ...period(from, to), partnerId: partnerId || undefined });
  }
}
