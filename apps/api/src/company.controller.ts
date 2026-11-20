import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { missingDocuments } from "./driver-docs";
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
          firstName: d.firstName, lastName: d.lastName, phone: d.phone, email: d.email, companyId: req.company.id,
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
    return this.prisma.vehicle.findMany({ where: { companyId: req.company.id }, include: { driver: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { plate: "asc" } });
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
    const rows = rides.map((r) => ({
      rideId: r.id, pickupAt: r.pickupAt, reference: r.booking.externalReference, driver: `${r.driver!.firstName} ${r.driver!.lastName}`, driverId: r.driver!.id,
      route: `${r.pickupAddress} → ${r.dropoffAddress}`, grossCents: r.priceCents, commissionCents: r.commissionCents, netCents: r.driverNetCents,
    }));
    const sum = (k: "grossCents" | "commissionCents" | "netCents") => rows.reduce((s, r) => s + r[k], 0);
    const byDriver = new Map<string, { driverId: string; driver: string; rides: number; netCents: number }>();
    for (const r of rows) {
      const e = byDriver.get(r.driverId) ?? { driverId: r.driverId, driver: r.driver, rides: 0, netCents: 0 };
      e.rides++; e.netCents += r.netCents; byDriver.set(r.driverId, e);
    }
    return { period: { from: from.toISOString(), to: to.toISOString() }, rows, totals: { rides: rows.length, grossCents: sum("grossCents"), commissionCents: sum("commissionCents"), netCents: sum("netCents") }, byDriver: [...byDriver.values()] };
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
    const head = ["date", "reference", "chauffeur", "trajet", "brut_eur", "commission_eur", "net_eur"];
    const lines = [head.join(";"), ...s.rows.map((r) => [r.pickupAt.toISOString(), r.reference, r.driver, r.route, r.grossCents / 100, r.commissionCents / 100, r.netCents / 100].map(csvCell).join(";"))];
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="releve-paiements.csv"');
    res.send("﻿" + lines.join("\n"));
  }
}
