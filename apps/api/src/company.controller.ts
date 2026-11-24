import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { missingDocuments } from "./driver-docs";
import { checkVehicle } from "./vehicle-rules";
import { parse } from "./http";
import { csvCell } from "./metrics";
import { PerformanceService } from "./performance.service";
import { PrismaService } from "./prisma";
import { DriverCreateSchema, VehicleCreateSchema } from "./schemas";
import { CompanyGuard } from "./security";

/** Période par défaut : 7 derniers jours. Dates invalides ou plage > 1 an refusées. */
export function period(from?: string, to?: string, defaultDays = 7) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - defaultDays * 86400_000);
  if (isNaN(end.getTime()) || isNaN(start.getTime()) || start >= end) throw new HttpException({ errors: { period: ["dates invalides"] } }, 422);
  if (end.getTime() - start.getTime() > 366 * 86400_000) throw new HttpException({ errors: { period: ["plage maximale : 1 an"] } }, 422);
  return { from: start, to: end };
}

@Controller("company")
@UseGuards(CompanyGuard)
export class CompanyController {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(PerformanceService) private perf: PerformanceService,
  ) {}

  private async ownDriver(companyId: string, id: string) {
    const d = await this.prisma.driver.findFirst({ where: { id, companyId } });
    if (!d) throw new HttpException("Chauffeur introuvable", 404);
    return d;
  }

  @Get("me")
  async me(@Req() req: any) {
    const c = req.company;
    const [drivers, vehicles] = await Promise.all([this.prisma.driver.count({ where: { companyId: c.id } }), this.prisma.vehicle.count({ where: { companyId: c.id } })]);
    return { id: c.id, name: c.name, siret: c.siret, vtcRegistry: c.vtcRegistry, drivers, vehicles };
  }

  // ---- chauffeurs ----
  @Get("drivers")
  async drivers(@Req() req: any) {
    const list = await this.prisma.driver.findMany({
      where: { companyId: req.company.id },
      include: { vehicles: true, documents: { select: { id: true, type: true, status: true, expiresAt: true } } },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(list.map(async (d) => ({ ...d, missingDocuments: await missingDocuments(this.prisma, d.id) })));
  }

  @Post("drivers")
  async createDriver(@Req() req: any, @Body() body: unknown) {
    const d = parse(DriverCreateSchema, body);
    try {
      return await this.prisma.driver.create({
        data: {
          firstName: d.firstName, lastName: d.lastName, phone: d.phone, email: d.email, companyId: req.company.id, proCardNumber: d.proCardNumber,
          vehicles: d.vehicle ? { create: { ...d.vehicle, companyId: req.company.id } } : undefined,
        },
        include: { vehicles: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpException("Téléphone, e-mail ou plaque déjà utilisé", 409);
      throw e;
    }
  }

  @Post("drivers/:id/suspend")
  async suspend(@Req() req: any, @Param("id") id: string) {
    await this.ownDriver(req.company.id, id);
    return this.prisma.driver.update({ where: { id }, data: { status: "SUSPENDED", availability: "SUSPENDED", suspendedBy: "company" } });
  }

  /** Une société ne peut lever que SA suspension, jamais celle décidée par la plateforme. */
  @Post("drivers/:id/resume")
  async resume(@Req() req: any, @Param("id") id: string) {
    const d = await this.ownDriver(req.company.id, id);
    if (d.status !== "SUSPENDED") throw new HttpException("Le chauffeur n'est pas suspendu", 409);
    if (d.suspendedBy !== "company") throw new HttpException("Suspension décidée par la plateforme : contactez le support", 403);
    const missing = await missingDocuments(this.prisma, id);
    if (missing.length) throw new HttpException({ message: "Documents manquants ou expirés", missing }, 409);
    return this.prisma.driver.update({ where: { id }, data: { status: "ACTIVE", suspendedBy: null } });
  }

  // ---- véhicules ----
  @Get("vehicles")
  vehicles(@Req() req: any) {
    return this.prisma.vehicle.findMany({ where: { companyId: req.company.id }, include: { driver: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { plate: "asc" } })
      .then((list) => list.map((v) => ({ ...v, compliance: checkVehicle(v) })));
  }

  @Post("vehicles")
  async createVehicle(@Req() req: any, @Body() body: unknown) {
    const { driverId, ...v } = parse(VehicleCreateSchema, body);
    if (driverId) await this.ownDriver(req.company.id, driverId);
    try {
      return await this.prisma.vehicle.create({ data: { ...v, companyId: req.company.id, driverId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpException("Plaque déjà enregistrée", 409);
      throw e;
    }
  }

  // ---- missions ----
  @Get("rides")
  async rides(@Req() req: any, @Query() q: Record<string, string>) {
    const { from, to } = period(q.from, q.to, 30);
    const drivers = await this.prisma.driver.findMany({ where: { companyId: req.company.id }, select: { id: true } });
    const ids = drivers.map((d) => d.id);
    if (q.driverId && !ids.includes(q.driverId)) throw new HttpException("Chauffeur introuvable", 404);
    const rides = await this.prisma.ride.findMany({
      where: {
        driverId: q.driverId ? q.driverId : { in: ids }, pickupAt: { gte: from, lt: to },
        ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}), ...(q.status ? { status: q.status as any } : {}),
      },
      include: { driver: { select: { firstName: true, lastName: true } }, vehicle: { select: { plate: true } }, booking: { select: { flightNumber: true } } },
      orderBy: { pickupAt: "desc" }, take: 500,
    });
    return rides.map((r) => ({
      id: r.id, status: r.status, pickupAt: r.pickupAt, pickup: r.pickupAddress, dropoff: r.dropoffAddress, category: r.category,
      driver: r.driver ? `${r.driver.firstName} ${r.driver.lastName}` : null, plate: r.vehicle?.plate ?? null,
      flight: r.booking.flightNumber, flightDelayMin: r.flightDelayMin, netCents: r.driverNetCents,
    }));
  }

  // ---- performance ----
  @Get("performance")
  async performance(@Req() req: any, @Query() q: Record<string, string>) {
    const { from, to } = period(q.from, q.to);
    return this.perf.compute({ companyId: req.company.id, driverId: q.driverId || undefined, vehicleId: q.vehicleId || undefined, from, to });
  }

  // ---- relevé de paiements ----
  private async statement(companyId: string, from: Date, to: Date) {
    const rides = await this.prisma.ride.findMany({
      where: { status: "COMPLETED", pickupAt: { gte: from, lt: to }, driver: { companyId } },
      include: { driver: { select: { id: true, firstName: true, lastName: true } }, booking: { select: { externalReference: true } } },
      orderBy: { pickupAt: "asc" },
    });
    const cancelled = await this.prisma.ride.findMany({
      where: { status: { in: ["CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT"] }, driverCompensationCents: { gt: 0 }, cancelledAt: { gte: from, lt: to }, driver: { companyId } },
      include: { driver: { select: { id: true, firstName: true, lastName: true } }, booking: { select: { externalReference: true } } },
      orderBy: { cancelledAt: "asc" },
    });
    const compRows = cancelled.map((r) => ({
      kind: "ANNULATION" as const, rideId: r.id, pickupAt: r.pickupAt, at: r.cancelledAt!, reference: `R-${r.ref}`, driver: `${r.driver!.firstName} ${r.driver!.lastName}`, driverId: r.driver!.id,
      route: `${r.pickupAddress} → ${r.dropoffAddress}`, grossCents: r.cancellationFeeCents, commissionCents: r.cancellationFeeCents - r.driverCompensationCents, netCents: r.driverCompensationCents,
    }));
    const pens = await this.prisma.driverPenalty.findMany({
      where: { waivedAt: null, createdAt: { gte: from, lt: to }, driver: { companyId } },
      include: { driver: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" },
    });
    const penaltyRides = await this.prisma.ride.findMany({ where: { id: { in: pens.map((p) => p.rideId) } }, select: { id: true, ref: true, pickupAt: true, pickupAddress: true, dropoffAddress: true } });
    const rideOf = new Map(penaltyRides.map((r) => [r.id, r]));
    const penRows = pens.map((p) => {
      const r = rideOf.get(p.rideId)!;
      return {
        kind: "PENALITE" as const, rideId: p.rideId, pickupAt: r.pickupAt, at: p.createdAt, reference: `R-${r.ref}`, driver: `${p.driver.firstName} ${p.driver.lastName}`, driverId: p.driver.id,
        route: `${p.kind === "RESCUE" ? "Pénalité (sauveteur)" : "Pénalité (mission rendue)"} · ${r.pickupAddress} → ${r.dropoffAddress}`, grossCents: 0, commissionCents: 0, netCents: -p.amountCents,
      };
    });
    // Mise en commun : part reversée à cette société pour les missions confiées à une autre société et réalisées.
    const pools = await this.prisma.ridePool.findMany({
      where: { fromCompanyId: companyId, status: "TAKEN", shareCents: { gt: 0 }, ride: { status: "COMPLETED", pickupAt: { gte: from, lt: to } } },
      include: { ride: true, toCompany: { select: { name: true } } },
    });
    const poolDrivers = await this.prisma.driver.findMany({ where: { id: { in: pools.map((p) => p.fromDriverId) } }, select: { id: true, firstName: true, lastName: true } });
    const nameOf = new Map(poolDrivers.map((d) => [d.id, `${d.firstName} ${d.lastName}`]));
    const poolRows = pools.map((p) => ({
      kind: "MISE_EN_COMMUN" as const, rideId: p.rideId, pickupAt: p.ride.pickupAt, at: p.ride.pickupAt, reference: `R-${p.ride.ref}`, driver: nameOf.get(p.fromDriverId) ?? "?", driverId: p.fromDriverId,
      route: `Confiée à ${p.toCompany?.name ?? "une société partenaire"} (${p.sharePercent} %) · ${p.ride.pickupAddress} → ${p.ride.dropoffAddress}`, grossCents: 0, commissionCents: 0, netCents: p.shareCents,
    }));
    const rows = [...rides.map((r) => ({
      kind: "COURSE" as const, rideId: r.id, pickupAt: r.pickupAt, at: r.pickupAt, reference: r.booking.externalReference ?? `R-${r.ref}`, driver: `${r.driver!.firstName} ${r.driver!.lastName}`, driverId: r.driver!.id,
      route: `${r.pickupAddress} → ${r.dropoffAddress}`, grossCents: r.priceCents, commissionCents: r.commissionCents, netCents: r.driverNetCents,
    })), ...compRows, ...penRows, ...poolRows].sort((a, b) => a.at.getTime() - b.at.getTime());
    const sum = (k: "grossCents" | "commissionCents" | "netCents") => rows.reduce((s, r) => s + r[k], 0);
    const byDriver = new Map<string, { driverId: string; driver: string; rides: number; netCents: number }>();
    for (const r of rows) {
      const e = byDriver.get(r.driverId) ?? { driverId: r.driverId, driver: r.driver, rides: 0, netCents: 0 };
      if (r.kind === "COURSE") e.rides++; // une indemnité d'annulation n'est pas une mission réalisée
      e.netCents += r.netCents; byDriver.set(r.driverId, e);
    }
    return { period: { from: from.toISOString(), to: to.toISOString() }, rows, totals: { rides: rides.length, cancellations: compRows.length, penalties: penRows.length, grossCents: sum("grossCents"), commissionCents: sum("commissionCents"), netCents: sum("netCents") }, byDriver: [...byDriver.values()] };
  }

  @Get("payments")
  payments(@Req() req: any, @Query() q: Record<string, string>) {
    const { from, to } = period(q.from, q.to, 15);
    return this.statement(req.company.id, from, to);
  }

  @Get("payments.csv")
  async paymentsCsv(@Req() req: any, @Query() q: Record<string, string>, @Res() res: any) {
    const { from, to } = period(q.from, q.to, 15);
    const s = await this.statement(req.company.id, from, to);
    const head = ["date", "type", "reference", "chauffeur", "trajet", "brut_eur", "commission_eur", "net_eur"];
    const lines = [head.join(";"), ...s.rows.map((r) => [r.at.toISOString(), r.kind, r.reference, r.driver, r.route, r.grossCents / 100, r.commissionCents / 100, r.netCents / 100].map(csvCell).join(";"))];
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="releve-paiements.csv"');
    res.send("﻿" + lines.join("\n"));
  }
}
