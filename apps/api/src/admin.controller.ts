import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { DispatchService } from "./dispatch.service";
import { missingDocuments, missingIdentifiers, REQUIRED_DOCS } from "./driver-docs";
import { FlightsService } from "./flights.service";
import { period } from "./company.controller";
import { checkVehicle } from "./vehicle-rules";
import { PerformanceService } from "./performance.service";
import { NotificationsService } from "./notifications";
import { csvCell } from "./metrics";
import { parse } from "./http";
import { z } from "zod";
import { PrismaService } from "./prisma";
import { AdminUserCreateSchema, PasswordResetSchema, AssignSchema, CompanyCreateSchema, DriverCreateSchema, FlightUpdateSchema, PartnerCreateSchema, ReviewSchema } from "./schemas";
import { AdminGuard, AdminIdentity, AdminOnly, generateApiKey, generateCompanyKey } from "./security";
import { AuthService, publicUser } from "./auth.service";
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
    @Inject(AuthService) private auth: AuthService,
    @Inject(NotificationsService) private notifications: NotificationsService,
  ) {}

  // ---- équipe (comptes du back-office) : administrateurs uniquement ----
  @Get("users")
  @AdminOnly()
  async users() {
    return (await this.prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } })).map(publicUser);
  }

  @Post("users")
  @AdminOnly()
  createUser(@Req() req: any, @Body() body: unknown) {
    return this.auth.createUser(req.admin.actor, parse(AdminUserCreateSchema, body));
  }

  @Post("users/:id/deactivate")
  @AdminOnly()
  async deactivate(@Req() req: any, @Param("id") id: string) {
    await this.auth.setActive(req.admin.actor, id, false);
    return { ok: true };
  }

  @Post("users/:id/activate")
  @AdminOnly()
  async activate(@Req() req: any, @Param("id") id: string) {
    await this.auth.setActive(req.admin.actor, id, true);
    return { ok: true };
  }

  @Post("users/:id/password")
  @AdminOnly()
  async resetPassword(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    await this.auth.setPassword(req.admin.actor, id, parse(PasswordResetSchema, body).password);
    return { ok: true };
  }

  @Get("partners")
  @AdminOnly()
  partners() {
    return this.prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  /** Crée un partenaire ; la clé API et le secret webhook ne sont affichés QU'UNE FOIS. */
  @Post("partners")
  @AdminOnly()
  async createPartner(@Body() body: unknown) {
    const p = parse(PartnerCreateSchema, body);
    const webhookSecret = p.webhookUrl ? `whsec_${randomBytes(24).toString("hex")}` : null;
    const partner = await this.prisma.partner.create({
      data: { name: p.name, webhookUrl: p.webhookUrl, webhookSecret, priceMultiplier: p.priceMultiplier, commissionRate: p.commissionRate, paymentMode: p.paymentMode, notifyPassenger: p.notifyPassenger },
    });
    const k = generateApiKey(true);
    await this.prisma.apiKey.create({ data: { partnerId: partner.id, keyHash: k.hash, prefix: k.prefix, sandbox: true } });
    return { partnerId: partner.id, apiKey: k.key, webhookSecret };
  }

  /** Relevé de rapprochement du pilote B2B, à partir des courses réelles du partenaire. */
  @Get("partners/:id/statement.csv")
  @AdminOnly()
  async partnerStatement(@Param("id") id: string, @Query("from") start: string, @Query("to") end: string, @Res() res: any) {
    const { from, to } = period(start, end, 30);
    if (!(await this.prisma.partner.findUnique({ where: { id }, select: { id: true } }))) {
      throw new HttpException("Partenaire introuvable", 404);
    }
    const rides = await this.prisma.ride.findMany({
      where: {
        booking: { partnerId: id },
        events: { some: { type: "booking.confirmed", payload: { path: ["sandbox"], equals: false } } },
        OR: [
          { status: "COMPLETED", pickupAt: { gte: from, lt: to } },
          { status: { in: ["CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT"] }, cancelledAt: { gte: from, lt: to } },
        ],
      },
      select: {
        id: true, ref: true, status: true, pickupAt: true, cancelledAt: true, priceCents: true,
        cancellationFeeCents: true, driverNetCents: true, driverCompensationCents: true,
        booking: { select: { externalReference: true } },
      },
      orderBy: { ref: "asc" },
    });
    const rows = rides.map((ride) => {
      const completed = ride.status === "COMPLETED";
      const at = completed ? ride.pickupAt : ride.cancelledAt!;
      const gross = completed ? ride.priceCents : ride.cancellationFeeCents;
      const net = completed ? ride.driverNetCents : ride.driverCompensationCents;
      return [at.toISOString(), ride.status, ride.id, `R-${ride.ref}`, ride.booking.externalReference,
        (gross / 100).toFixed(2), (net / 100).toFixed(2), "EUR"].map(csvCell).join(";");
    });
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="releve-partenaire.csv"');
    res.send("\uFEFF" + ["date;statut;course_id;course;reference_partenaire;montant_partenaire;montant_chauffeur;devise", ...rows].join("\n"));
  }

  @Post("drivers")
  @AdminOnly()
  async createDriver(@Body() body: unknown) {
    const d = parse(DriverCreateSchema, body);
    try {
      return await this.prisma.driver.create({
        data: {
          firstName: d.firstName, lastName: d.lastName, phone: d.phone, email: d.email,
          businessName: d.businessName, siret: d.siret, revtcNumber: d.revtcNumber, proCardNumber: d.proCardNumber,
          vehicles: d.vehicle ? { create: d.vehicle } : undefined,
        },
        include: { vehicles: true },
      });
    } catch (e) {
      // Doublon (téléphone, e-mail ou plaque) : réponse claire au lieu d'une erreur 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpException(`Déjà utilisé : ${([] as string[]).concat((e.meta?.target as any) ?? []).join(", ") || "téléphone, e-mail ou plaque"}`, 409);
      throw e;
    }
  }

  @Get("drivers")
  drivers(@Query("status") status?: string) {
    return this.prisma.driver.findMany({
      where: status ? { status: status as any } : {},
      include: { vehicles: true, documents: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }).then((list) => list.map((d) => ({ ...d, vehicles: d.vehicles.map((v) => ({ ...v, compliance: checkVehicle(v) })) })));
  }

  /**
   * Badge d'accès aéroport vérifié par l'équipe (facture de parking ADP vue par un humain) : le chauffeur ne peut pas encore
   * envoyer sa facture depuis l'application. Retirer le badge le refuse ; les départs d'aéroport se ferment aussitôt.
   */
  @Post("drivers/:id/airport-badge")
  @AdminOnly()
  async airportBadge(@Req() req: { admin: AdminIdentity }, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(z.object({ verified: z.boolean(), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(), body);
    await this.prisma.driver.findUniqueOrThrow({ where: { id } }).catch(() => { throw new HttpException("Chauffeur introuvable", 404); });
    if (!b.verified) {
      await this.prisma.document.updateMany({ where: { driverId: id, type: "AIRPORT_BADGE", status: { in: ["APPROVED", "PENDING"] } }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: req.admin.actor } });
      return { airportBadge: false };
    }
    // Fin de validité de la facture (facultative) : fin de journée, heure de Paris approximée par 23:59 UTC.
    const expiresAt = b.expiresAt ? new Date(`${b.expiresAt}T23:59:00Z`) : null;
    if (expiresAt && expiresAt <= new Date()) throw new HttpException("Date de fin déjà passée", 422);
    await this.prisma.document.create({ data: { driverId: id, type: "AIRPORT_BADGE", storageKey: `verifie-par-equipe:${req.admin.actor}`, status: "APPROVED", reviewedAt: new Date(), reviewedBy: req.admin.actor, expiresAt } });
    return { airportBadge: true, expiresAt };
  }

  @Post("documents/:id/review")
  @AdminOnly()
  async reviewDocument(@Param("id") id: string, @Body() body: unknown) {
    const { status } = parse(ReviewSchema, body);
    return this.prisma.document.update({ where: { id }, data: { status, reviewedAt: new Date(), reviewedBy: "admin" } });
  }

  @Post("drivers/:id/approve")
  @AdminOnly()
  async approve(@Param("id") id: string) {
    const missing = await missingDocuments(this.prisma, id);
    if (missing.length) throw new HttpException({ message: "Documents manquants ou expirés", missing }, 409);
    const unidentified = await missingIdentifiers(this.prisma, id);
    if (unidentified.length) throw new HttpException({ message: "Identité d'exploitant incomplète", missingIdentifiers: unidentified }, 409);
    // Au moins un véhicule actif doit respecter les critères d'admission.
    const vehicles = await this.prisma.vehicle.findMany({ where: { driverId: id, active: true } });
    if (!vehicles.some((v) => checkVehicle(v).ok)) {
      throw new HttpException({ message: "Aucun véhicule conforme aux critères d'admission", vehicleProblems: vehicles.map((v) => ({ plate: v.plate, problems: checkVehicle(v).problems })) }, 409);
    }
    return this.prisma.driver.update({ where: { id }, data: { status: "ACTIVE", suspendedBy: null } });
  }

  @Post("drivers/:id/suspend")
  @AdminOnly()
  suspend(@Param("id") id: string) {
    return this.prisma.driver.update({ where: { id }, data: { status: "SUSPENDED", availability: "SUSPENDED", suspendedBy: "admin" } });
  }

  @Get("rides")
  rides(@Query("status") status?: string) {
    return this.prisma.ride.findMany({
      where: status ? { status: status as any } : {},
      include: { booking: { include: { partner: true } }, driver: true, vehicle: true, offers: true, trackingDeliveries: { select: { channel: true, status: true } } },
      orderBy: { pickupAt: "asc" },
      take: 200,
    });
  }

  @Get("rides/:id/events")
  events(@Param("id") id: string) {
    return this.prisma.rideEvent.findMany({ where: { rideId: id }, orderBy: { createdAt: "asc" } });
  }

  @Post("rides/:id/tracking/retry")
  async retryTracking(@Param("id") id: string) {
    const result = await this.notifications.retryTrackingLinks(id);
    return { queued: result.count };
  }

  /** Correction d'étape par le dispatcheur (glisser-déposer au tableau), avec motif obligatoire. */
  @Post("rides/:id/revert")
  async revert(@Req() req: { admin: AdminIdentity }, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(z.object({ to: z.enum(["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"]), reason: z.string().trim().min(3, "motif obligatoire").max(300) }).strict(), body);
    return this.dispatch.adminRevertStatus(id, req.admin, b.to, b.reason);
  }

  @Post("rides/:id/assign")
  async assign(@Req() req: { admin: AdminIdentity }, @Param("id") id: string, @Body() body: unknown) {
    await this.dispatch.adminAssign(id, req.admin, parse(AssignSchema, body));
    return { status: "ASSIGNED" };
  }

  /** Courses sans chauffeur après tous les tours de dispatch : à traiter par un opérateur. */
  /** Crée une société ; sa clé d'accès n'est affichée qu'une fois. */
  @Post("companies")
  @AdminOnly()
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
    return this.perf.compute({ companyId: q.companyId || undefined, driverId: q.driverId || undefined, vehicleId: q.vehicleId || undefined, from, to }, { includePlatform: true });
  }

  /** Mise à jour manuelle du vol (opérateur) : même chemin que le futur fournisseur de données de vol. */
  @Post("rides/:id/flight")
  async flight(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(FlightUpdateSchema, body);
    return this.flights.update(id, { ...("estimatedArrivalAt" in b ? { estimatedArrivalAt: b.estimatedArrivalAt ? new Date(b.estimatedArrivalAt) : null } : {}), status: b.status }, req.admin.actor);
  }

  @Get("alerts")
  async alerts() {
    const rides = await this.prisma.ride.findMany({
      where: { status: "DISPATCHING", events: { some: { type: "dispatch.exhausted" } } },
      include: { booking: { include: { partner: true } } },
      orderBy: { pickupAt: "asc" },
    });
    // Vols annulés : le client ne viendra pas ; l'équipe tranche avec le partenaire (annulation, report). Aucune annulation automatique.
    const cancelledFlights = await this.prisma.ride.findMany({
      where: { flightStatus: "CANCELLED", status: { in: ["DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED"] } },
      include: { booking: { include: { partner: true } } },
      orderBy: { pickupAt: "asc" },
    });
    // Missions à risque : sans chauffeur à l'approche de la prise en charge (et pas encore épuisées : sinon déjà listées ci-dessus).
    const atRisk = await this.prisma.ride.findMany({
      where: { status: "DISPATCHING", AND: [{ events: { some: { type: "dispatch.at_risk" } } }, { events: { none: { type: "dispatch.exhausted" } } }] },
      include: { booking: { include: { partner: true } } },
      orderBy: { pickupAt: "asc" },
    });
    return [
      ...atRisk.map((r) => ({ reason: "AT_RISK", rideId: r.id, ref: r.ref, pickupAt: r.pickupAt, pickup: r.pickupAddress, partner: r.booking.partner?.name })),
      ...rides.map((r) => ({ reason: "NO_DRIVER", rideId: r.id, ref: r.ref, pickupAt: r.pickupAt, pickup: r.pickupAddress, partner: r.booking.partner?.name })),
      ...cancelledFlights.map((r) => ({ reason: "FLIGHT_CANCELLED", rideId: r.id, ref: r.ref, pickupAt: r.pickupAt, pickup: r.pickupAddress, partner: r.booking.partner?.name, flight: r.booking.flightNumber })),
    ];
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
