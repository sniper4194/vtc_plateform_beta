import { HttpException, Inject, Injectable } from "@nestjs/common";
import { aggregate, Earnings, missionMinutes, Period, PERIODS, periodBounds } from "./earnings";
import { driverSeesClientPrice } from "./messages";
import { PrismaService } from "./prisma";

const UPCOMING = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] as const;

@Injectable()
export class EarningsService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  /** Bornes demandées : une période nommée, ou un intervalle explicite (90 jours au plus). */
  bounds(period?: string, from?: string, to?: string, now = new Date()) {
    if (from || to) {
      const f = from ? new Date(from) : null, t = to ? new Date(to) : null;
      if (!f || !t || isNaN(+f) || isNaN(+t) || t <= f) throw new HttpException("Intervalle invalide", 422);
      if (t.getTime() - f.getTime() > 92 * 86400_000) throw new HttpException("Intervalle limité à 92 jours", 422);
      return { period: "custom" as const, from: f, to: t };
    }
    const p = (period ?? "fortnight") as Period;
    if (!PERIODS.includes(p)) throw new HttpException("Période inconnue (day, week, fortnight, month)", 422);
    return { period: p, ...periodBounds(p, now) };
  }

  async compute(driverId: string, from: Date, to: Date): Promise<Earnings & { upcomingCents: number; upcomingRides: number; showClientPrice: boolean }> {
    const rides = await this.prisma.ride.findMany({ where: { driverId, status: "COMPLETED", pickupAt: { gte: from, lt: to } }, orderBy: { pickupAt: "asc" }, take: 1000 });
    const events = rides.length
      ? await this.prisma.rideEvent.findMany({ where: { rideId: { in: rides.map((r) => r.id) }, type: { in: ["ride.en_route", "ride.completed"] } }, orderBy: { createdAt: "asc" } })
      : [];
    const last = (id: string, type: string) => [...events].reverse().find((e) => e.rideId === id && e.type === type)?.createdAt ?? null;
    const show = driverSeesClientPrice();
    const lines = rides.map((r) => ({
      rideId: r.id, ref: r.ref, at: r.pickupAt, route: `${r.pickupAddress} → ${r.dropoffAddress}`, netCents: r.driverNetCents,
      clientCents: show ? r.priceCents : null, commissionCents: show ? r.commissionCents : null,
      missionMin: missionMinutes(last(r.id, "ride.en_route"), last(r.id, "ride.completed"), r.durationMin),
    }));
    const comps = await this.prisma.ride.findMany({
      where: { driverId, status: { in: ["CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT"] }, driverCompensationCents: { gt: 0 }, cancelledAt: { gte: from, lt: to } },
    });
    const pens = await this.prisma.driverPenalty.findMany({ where: { driverId, waivedAt: null, createdAt: { gte: from, lt: to } } });
    const penRides = await this.prisma.ride.findMany({ where: { id: { in: pens.map((p) => p.rideId) } }, select: { id: true, ref: true } });
    const refOf = new Map(penRides.map((r) => [r.id, r.ref]));
    const upcoming = await this.prisma.ride.aggregate({ _sum: { driverNetCents: true }, _count: { _all: true }, where: { driverId, status: { in: [...UPCOMING] }, pickupAt: { gte: new Date() } } });
    const e = aggregate(
      lines,
      comps.map((r) => ({ rideId: r.id, ref: r.ref, at: r.cancelledAt!, cents: r.driverCompensationCents })),
      pens.map((p) => ({ id: p.id, ref: refOf.get(p.rideId) ?? null, at: p.createdAt, cents: p.amountCents, kind: p.kind })),
    );
    return { ...e, upcomingCents: upcoming._sum.driverNetCents ?? 0, upcomingRides: upcoming._count._all, showClientPrice: show };
  }
}
