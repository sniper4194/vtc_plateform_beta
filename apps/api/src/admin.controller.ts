import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { DispatchService } from "./dispatch.service";
import { missingDocuments, REQUIRED_DOCS } from "./driver-docs";
import { FlightsService } from "./flights.service";
import { period } from "./company.controller";
import { PerformanceService } from "./performance.service";
import { parse } from "./http";
import { PrismaService } from "./prisma";
import { AssignSchema, CompanyCreateSchema, DriverCreateSchema, FlightUpdateSchema, PartnerCreateSchema, ReviewSchema } from "./schemas";
import { AdminGuard, generateApiKey, generateCompanyKey } from "./security";
import { WebhooksService } from "./webhooks.service";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(DispatchService) private dispatch: DispatchService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(FlightsService) private flights: FlightsService,
    @Inject(PerformanceService) private perf: PerformanceService,
  ) {}

  /** Crée un partenaire ; la clé API et le secret webhook ne sont affichés QU'UNE FOIS. */
  @Post("partners")
  async createPartner(@Body() body: unknown) {
    const p = parse(PartnerCreateSchema, body);
    const webhookSecret = p.webhookUrl ? `whsec_${randomBytes(24).toString("hex")}` : null;
    const partner = await this.prisma.partner.create({
      data: { name: p.name, webhookUrl: p.webhookUrl, webhookSecret, priceMultiplier: p.priceMultiplier, commissionRate: p.commissionRate, paymentMode: p.paymentMode },
    });
    const k = generateApiKey(true);
    await this.prisma.apiKey.create({ data: { partnerId: partner.id, keyHash: k.hash, prefix: k.prefix, sandbox: true } });
    return { partnerId: partner.id, apiKey: k.key, webhookSecret };
  }

  @Post("drivers")
  async createDriver(@Body() body: unknown) {
    const d = parse(DriverCreateSchema, body);
    return this.prisma.driver.create({
      data: {
        firstName: d.firstName, lastName: d.lastName, phone: d.phone, email: d.email,
        vehicles: d.vehicle ? { create: d.vehicle } : undefined,
      },
      include: { vehicles: true },
    });
  }

  @Get("drivers")
  drivers(@Query("status") status?: string) {
    return this.prisma.driver.findMany({
      where: status ? { status: status as any } : {},
      include: { vehicles: true, documents: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  @Post("documents/:id/review")
  async reviewDocument(@Param("id") id: string, @Body() body: unknown) {
    const { status } = parse(ReviewSchema, body);
    return this.prisma.document.update({ where: { id }, data: { status, reviewedAt: new Date(), reviewedBy: "admin" } });
  }

  @Post("drivers/:id/approve")
  async approve(@Param("id") id: string) {
    const missing = await missingDocuments(this.prisma, id);
    if (missing.length) throw new HttpException({ message: "Documents manquants ou expirés", missing }, 409);
    return this.prisma.driver.update({ where: { id }, data: { status: "ACTIVE", suspendedBy: null } });
  }

  @Post("drivers/:id/suspend")
  suspend(@Param("id") id: string) {
    return this.prisma.driver.update({ where: { id }, data: { status: "SUSPENDED", availability: "SUSPENDED", suspendedBy: "admin" } });
  }

  @Get("rides")
  rides(@Query("status") status?: string) {
    return this.prisma.ride.findMany({
      where: status ? { status: status as any } : {},
      include: { booking: { include: { partner: true } }, driver: true, vehicle: true, offers: true },
      orderBy: { pickupAt: "asc" },
      take: 200,
    });
  }

  @Get("rides/:id/events")
  events(@Param("id") id: string) {
    return this.prisma.rideEvent.findMany({ where: { rideId: id }, orderBy: { createdAt: "asc" } });
  }

  @Post("rides/:id/assign")
  async assign(@Param("id") id: string, @Body() body: unknown) {
    const { driverId } = parse(AssignSchema, body);
    await this.dispatch.adminAssign(id, driverId);
    return { status: "ASSIGNED" };
  }

  /** Courses sans chauffeur après tous les tours de dispatch : à traiter par un opérateur. */
  /** Crée une société ; sa clé d'accès n'est affichée qu'une fois. */
  @Post("companies")
  async createCompany(@Body() body: unknown) {
    const c = parse(CompanyCreateSchema, body);
    const k = generateCompanyKey();
    try {
      const company = await this.prisma.company.create({ data: { ...c, accessKeyHash: k.hash, accessKeyPrefix: k.prefix } });
      return { companyId: company.id, accessKey: k.key };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpException("Une société avec ce SIRET existe déjà", 409);
      throw e;
    }
  }

  @Get("companies")
  async companies() {
    const list = await this.prisma.company.findMany({ include: { _count: { select: { drivers: true, vehicles: true } } }, orderBy: { name: "asc" } });
    return list.map((c) => ({ id: c.id, name: c.name, siret: c.siret, active: c.active, keyPrefix: c.accessKeyPrefix, drivers: c._count.drivers, vehicles: c._count.vehicles }));
  }

  @Get("performance")
  performance(@Query() q: Record<string, string>) {
    const { from, to } = period(q.from, q.to);
    return this.perf.compute({ companyId: q.companyId || undefined, driverId: q.driverId || undefined, vehicleId: q.vehicleId || undefined, from, to });
  }

  /** Mise à jour manuelle du vol (opérateur) : même chemin que le futur fournisseur de données de vol. */
  @Post("rides/:id/flight")
  async flight(@Param("id") id: string, @Body() body: unknown) {
    const b = parse(FlightUpdateSchema, body);
    return this.flights.update(id, { ...("estimatedArrivalAt" in b ? { estimatedArrivalAt: b.estimatedArrivalAt ? new Date(b.estimatedArrivalAt) : null } : {}), status: b.status }, "admin");
  }

  @Get("alerts")
  async alerts() {
    const rides = await this.prisma.ride.findMany({
      where: { status: "DISPATCHING", events: { some: { type: "dispatch.exhausted" } } },
      include: { booking: { include: { partner: true } } },
      orderBy: { pickupAt: "asc" },
    });
    return rides.map((r) => ({ rideId: r.id, pickupAt: r.pickupAt, pickup: r.pickupAddress, partner: r.booking.partner?.name }));
  }

  @Get("webhooks")
  deliveries(@Query("status") status?: string) {
    return this.prisma.webhookDelivery.findMany({ where: status ? { status: status as any } : {}, orderBy: { createdAt: "desc" }, take: 100 });
  }

  /** Force un passage des workers (utile en dev / démo). */
  @Post("run-workers")
  async runWorkers() {
    await this.dispatch.sweep();
    const delivered = await this.webhooks.deliverDue();
    return { delivered };
  }
}
