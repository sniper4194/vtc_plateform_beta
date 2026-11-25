import { Controller, Get, Inject, Injectable, Query, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "./prisma";
import { reliability, RideFacts } from "./guarantee";
import { effectivePickup } from "./metrics";
import { AdminGuard, PartnerGuard } from "./security";

const EVENT_TYPES = ["ride.assigned", "ride.arrived", "dispatch.exhausted", "dispatch.at_risk", "driver.cancelled"];

@Injectable()
export class ReliabilityService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  /** Faits de chaque course de la période (prise en charge passée), pour un partenaire ou pour tous. */
  async facts(days: number, partnerId?: string) {
    const to = new Date(), from = new Date(to.getTime() - days * 86_400_000);
    const rides = await this.prisma.ride.findMany({
      where: { pickupAt: { gte: from, lte: to }, ...(partnerId ? { booking: { partnerId } } : {}) },
      include: { booking: { include: { partner: true } }, events: { where: { type: { in: EVENT_TYPES } }, orderBy: { createdAt: "asc" } } },
    });
    return rides.map((r) => {
      const first = (t: string) => r.events.find((e) => e.type === t)?.createdAt ?? null;
      const f: RideFacts = {
        status: r.status, effectivePickupAt: effectivePickup(r.pickupAt, r.flightDelayMin), assignedAt: first("ride.assigned"), arrivedAt: first("ride.arrived"),
        exhausted: !!first("dispatch.exhausted"), atRisk: !!first("dispatch.at_risk"), gaveBack: r.events.filter((e) => e.type === "driver.cancelled").length,
      };
      return { partnerId: r.booking.partnerId ?? "aucun", partner: r.booking.partner?.name ?? "—", facts: f };
    });
  }

  async forPartner(partnerId: string, days: number) {
    return { days, ...reliability((await this.facts(days, partnerId)).map((x) => x.facts)) };
  }

  async byPartner(days: number) {
    const all = await this.facts(days);
    const groups = new Map<string, { partner: string; facts: RideFacts[] }>();
    for (const x of all) {
      const g = groups.get(x.partnerId) ?? { partner: x.partner, facts: [] };
      g.facts.push(x.facts); groups.set(x.partnerId, g);
    }
    return {
      days, total: reliability(all.map((x) => x.facts)),
      partners: [...groups.entries()].map(([id, g]) => ({ partnerId: id, partner: g.partner, ...reliability(g.facts) })).sort((a, b) => b.missions - a.missions),
    };
  }
}

const daysOf = (v?: string) => Math.min(365, Math.max(1, Number(v) || 30));

/** Le partenaire consulte la fiabilité de ses propres courses (ce que nous lui promettons, mesuré). */
@Controller("v1/reliability")
@UseGuards(PartnerGuard)
export class PartnerReliabilityController {
  constructor(@Inject(ReliabilityService) private svc: ReliabilityService) {}
  @Get() get(@Req() req: any, @Query("days") days?: string) { return this.svc.forPartner(req.partner.id, daysOf(days)); }
}

@Controller("admin/reliability")
@UseGuards(AdminGuard)
export class AdminReliabilityController {
  constructor(@Inject(ReliabilityService) private svc: ReliabilityService) {}
  @Get() get(@Query("days") days?: string) { return this.svc.byPartner(daysOf(days)); }
}
