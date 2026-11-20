import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { DispatchService, DriverAction } from "./dispatch.service";
import { parse } from "./http";
import { PrismaService } from "./prisma";
import { driverRideView } from "./views";
import { haversineKm } from "./zones";
import { AvailabilitySchema, DocumentUploadSchema, DriverLoginSchema, LocationUpdateSchema } from "./schemas";
import { config, DriverGuard, signToken } from "./security";

const ACTION_SET = new Set<DriverAction>(["en-route", "arrived", "start", "complete", "no-show"]);

function fortnightStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() <= 15 ? 1 : 16));
}

@Controller("driver")
export class DriverController {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(DispatchService) private dispatch: DispatchService,
  ) {}

  /** Connexion MVP : code OTP de développement. Les SMS OTP réels arrivent en phase 2. */
  @Post("login")
  async login(@Body() body: unknown) {
    const { phone, code } = parse(DriverLoginSchema, body);
    if (process.env.NODE_ENV === "production" && !process.env.DRIVER_DEV_OTP) throw new HttpException("OTP SMS non configuré", 501);
    const driver = await this.prisma.driver.findUnique({ where: { phone } });
    if (!driver || code !== (process.env.DRIVER_DEV_OTP ?? "000000")) throw new HttpException("Identifiants invalides", 401);
    return { token: signToken({ sub: driver.id, role: "driver" }, config.tokenSecret, 12 * 3600), driverId: driver.id };
  }

  @Get("me")
  @UseGuards(DriverGuard)
  async me(@Req() req: any) {
    const d = await this.prisma.driver.findUniqueOrThrow({
      where: { id: req.driverId },
      include: { vehicles: { where: { active: true } }, documents: true },
    });
    return {
      id: d.id, firstName: d.firstName, lastName: d.lastName, status: d.status, availability: d.availability,
      rating: d.rating, vehicles: d.vehicles, documents: d.documents.map((x) => ({ id: x.id, type: x.type, status: x.status, expiresAt: x.expiresAt })),
    };
  }

  @Get("home")
  @UseGuards(DriverGuard)
  async home(@Req() req: any) {
    const id: string = req.driverId;
    const now = new Date();
    const [upcoming, offers, earned] = await Promise.all([
      this.prisma.ride.count({ where: { driverId: id, status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } } }),
      this.prisma.dispatchOffer.findMany({ where: { driverId: id, status: "PENDING", expiresAt: { gt: now } }, include: { ride: true } }),
      this.prisma.ride.aggregate({ _sum: { driverNetCents: true }, where: { driverId: id, status: "COMPLETED", pickupAt: { gte: fortnightStart(now) } } }),
    ]);
    return {
      upcomingRides: upcoming,
      liveRideId: (await this.prisma.ride.findFirst({ where: { driverId: id, status: { in: ["EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } }, select: { id: true } }))?.id ?? null,
      pendingOffers: offers.length,
      potentialCents: offers.reduce((s, o) => s + o.ride.driverNetCents, 0),
      fortnightEarningsCents: earned._sum.driverNetCents ?? 0,
    };
  }

  @Post("availability")
  @UseGuards(DriverGuard)
  async availability(@Req() req: any, @Body() body: unknown) {
    const { availability } = parse(AvailabilitySchema, body);
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: req.driverId } });
    if (d.status !== "ACTIVE") throw new HttpException("Compte non actif", 403);
    await this.prisma.driver.update({ where: { id: d.id }, data: { availability } });
    return { availability };
  }

  @Post("location")
  @UseGuards(DriverGuard)
  async location(@Req() req: any, @Body() body: unknown) {
    const { lat, lng } = parse(LocationUpdateSchema, body);
    await this.prisma.driver.update({ where: { id: req.driverId }, data: { lastLat: lat, lastLng: lng, lastSeenAt: new Date() } });
    return { ok: true };
  }

  @Post("documents")
  @UseGuards(DriverGuard)
  async uploadDocument(@Req() req: any, @Body() body: unknown) {
    const d = parse(DocumentUploadSchema, body);
    // Phase 1 : on enregistre la référence. Phase 2 : URL pré-signée S3 + chiffrement.
    return this.prisma.document.create({ data: { driverId: req.driverId, type: d.type, storageKey: d.storageKey, expiresAt: d.expiresAt ? new Date(d.expiresAt) : null } });
  }

  /** Courses à prendre : le passager n'est PAS divulgué avant l'acceptation. */
  @Get("offers")
  @UseGuards(DriverGuard)
  async offers(@Req() req: any) {
    const now = new Date();
    const me = await this.prisma.driver.findUnique({ where: { id: req.driverId }, select: { lastLat: true, lastLng: true } });
    const distTo = (lat: number, lng: number) =>
      me?.lastLat != null && me.lastLng != null ? Math.round(haversineKm({ lat: me.lastLat, lng: me.lastLng }, { lat, lng }) * 10) / 10 : null;
    const offers = await this.prisma.dispatchOffer.findMany({
      where: { driverId: req.driverId, status: "PENDING", expiresAt: { gt: now }, ride: { status: "DISPATCHING" } },
      include: { ride: { include: { booking: { include: { partner: true } } } } },
      orderBy: { ride: { pickupAt: "asc" } },
    });
    return offers.map((o) => ({
      offerId: o.id,
      expiresAt: o.expiresAt,
      secondsLeft: Math.max(0, Math.round((o.expiresAt.getTime() - now.getTime()) / 1000)),
      pickupAt: o.ride.pickupAt, category: o.ride.category,
      partner: o.ride.booking.partner?.name ?? null,
      pickup: o.ride.pickupAddress, dropoff: o.ride.dropoffAddress,
      pickupDistanceKm: distTo(o.ride.pickupLat, o.ride.pickupLng),
      distanceKm: Math.round(o.ride.distanceKm * 10) / 10, durationMin: Math.round(o.ride.durationMin),
      netCents: o.ride.driverNetCents,
      netPerHourCents: Math.round(o.ride.driverNetCents / Math.max(o.ride.durationMin / 60, 0.25)),
      flightNumber: o.ride.booking.flightNumber,
    }));
  }

  @Post("offers/:id/accept")
  @UseGuards(DriverGuard)
  async accept(@Req() req: any, @Param("id") id: string) {
    await this.dispatch.accept(req.driverId, id);
    return { status: "ASSIGNED" };
  }

  @Post("offers/:id/decline")
  @UseGuards(DriverGuard)
  async decline(@Req() req: any, @Param("id") id: string) {
    await this.dispatch.decline(req.driverId, id);
    return { status: "DECLINED" };
  }

  @Get("rides")
  @UseGuards(DriverGuard)
  async rides(@Req() req: any, @Query("scope") scope = "upcoming") {
    const upcoming = scope !== "history";
    const rides = await this.prisma.ride.findMany({
      where: {
        driverId: req.driverId,
        status: upcoming ? { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } : { in: ["COMPLETED", "NO_SHOW", "DISPUTED", "REFUNDED"] },
      },
      include: { booking: { include: { partner: true } }, vehicle: true, driver: true, events: { where: { type: "ride.arrived" }, orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { pickupAt: upcoming ? "asc" : "desc" },
      take: 100,
    });
    return rides.map((r) => driverRideView(r, r.events[0]?.createdAt ?? null));
  }

  @Get("rides/:id")
  @UseGuards(DriverGuard)
  async ride(@Req() req: any, @Param("id") id: string) {
    const r = await this.prisma.ride.findFirst({
      where: { id, driverId: req.driverId },
      include: { booking: { include: { partner: true } }, vehicle: true, driver: true, events: { where: { type: "ride.arrived" }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!r) throw new HttpException("Mission introuvable", 404);
    return driverRideView(r, r.events[0]?.createdAt ?? null);
  }

  @Post("rides/:id/cancel")
  @UseGuards(DriverGuard)
  async cancel(@Req() req: any, @Param("id") id: string) {
    await this.dispatch.driverCancel(req.driverId, id);
    return { status: "DISPATCHING" };
  }

  @Post("rides/:id/:action")
  @UseGuards(DriverGuard)
  async act(@Req() req: any, @Param("id") id: string, @Param("action") action: string) {
    if (!ACTION_SET.has(action as DriverAction)) throw new HttpException("Action inconnue", 404);
    await this.dispatch.transition(req.driverId, id, action as DriverAction);
    return { ok: true };
  }
}
