import { Inject, Injectable } from "@nestjs/common";
import { Prisma, RideStatus } from "@prisma/client";
import { dayKeyTz, daysBetween, deltaPct, effectivePickup, pct, punctuality } from "./metrics";
import { PrismaService } from "./prisma";

export interface PerfFilter { companyId?: string; driverId?: string; vehicleId?: string; from: Date; to: Date }

const FINISHED: RideStatus[] = ["COMPLETED", "NO_SHOW", "DISPUTED", "REFUNDED"];

@Injectable()
export class PerformanceService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  private async scope(f: PerfFilter): Promise<{ driverIds?: string[] }> {
    if (!f.companyId && !f.driverId) return {};
    const drivers = await this.prisma.driver.findMany({
      where: { ...(f.companyId ? { companyId: f.companyId } : {}), ...(f.driverId ? { id: f.driverId } : {}) },
      select: { id: true },
    });
    return { driverIds: drivers.map((d) => d.id) };
  }

  async compute(f: PerfFilter) {
    const { driverIds } = await this.scope(f);
    const driverWhere: Prisma.RideWhereInput = driverIds ? { driverId: { in: driverIds } } : { driverId: { not: null } };
    const base: Prisma.RideWhereInput = { ...driverWhere, ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}) };
    const span = f.to.getTime() - f.from.getTime();
    const prevFrom = new Date(f.from.getTime() - span);

    const [rides, prev, offers, cancels, ratings] = await Promise.all([
      this.prisma.ride.findMany({
        where: { ...base, pickupAt: { gte: f.from, lt: f.to }, status: { in: FINISHED } },
        include: { events: { where: { type: "ride.arrived" }, orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      this.prisma.ride.aggregate({ _sum: { driverNetCents: true }, where: { ...base, pickupAt: { gte: prevFrom, lt: f.from }, status: "COMPLETED" } }),
      this.prisma.dispatchOffer.groupBy({
        by: ["status"], _count: true,
        where: { createdAt: { gte: f.from, lt: f.to }, ...(driverIds ? { driverId: { in: driverIds } } : {}) },
      }),
      driverIds && !driverIds.length ? Promise.resolve(0) : this.prisma.rideEvent.count({
        where: { type: "driver.cancelled", createdAt: { gte: f.from, lt: f.to }, ...(driverIds ? { actor: { in: driverIds.map((d) => `driver:${d}`) } } : {}) },
      }),
      this.prisma.rating.findMany({ where: { ride: { ...base, pickupAt: { gte: f.from, lt: f.to } } }, select: { score: true } }),
    ]);

    const series = new Map(daysBetween(f.from, f.to).map((d) => [d, { date: d, completed: 0, perfect: 0, average: 0, poor: 0, valueCents: 0 }]));
    let perfect = 0, average = 0, poor = 0, completed = 0, noShow = 0, value = 0, arrivedCount = 0, onTime = 0;
    for (const r of rides) {
      const arrivedAt = r.events[0]?.createdAt ?? null;
      const p = punctuality(arrivedAt, effectivePickup(r.pickupAt, r.flightDelayMin));
      const day = series.get(dayKeyTz(r.pickupAt));
      if (arrivedAt) { arrivedCount++; if (p === "PERFECT") onTime++; }
      if (p === "PERFECT") perfect++; else if (p === "AVERAGE") average++; else poor++;
      if (r.status === "NO_SHOW") noShow++;
      if (r.status === "COMPLETED") { completed++; value += r.driverNetCents; }
      if (day) {
        if (r.status === "COMPLETED") { day.completed++; day.valueCents += r.driverNetCents; }
        if (p === "PERFECT") day.perfect++; else if (p === "AVERAGE") day.average++; else day.poor++;
      }
    }
    const count = (s: string) => offers.find((o) => o.status === s)?._count ?? 0;
    const accepted = count("ACCEPTED"), refused = count("DECLINED") + count("EXPIRED");
    const prevValue = prev._sum.driverNetCents ?? 0;
    return {
      period: { from: f.from.toISOString(), to: f.to.toISOString() },
      totalValueCents: value,
      previousValueCents: prevValue,
      deltaPct: deltaPct(value, prevValue),
      rides: { finished: rides.length, completed, noShow, driverCancelled: cancels, perfect, average, poor },
      rates: {
        acceptancePct: pct(accepted, accepted + refused),
        onTimeAtPickupPct: pct(onTime, arrivedCount),
        completionPct: pct(completed, rides.length + cancels),
      },
      rating: { count: ratings.length, average: ratings.length ? Math.round((ratings.reduce((s, r) => s + r.score, 0) / ratings.length) * 10) / 10 : null },
      series: [...series.values()],
    };
  }
}
