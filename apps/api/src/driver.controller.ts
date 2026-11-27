import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { DispatchService, DriverAction } from "./dispatch.service";
import { parse } from "./http";
import { PrismaService } from "./prisma";
import { driverRideView } from "./views";
import { driverOfferCents } from "./ladder";
import { ecoBonusCents } from "./eco";
import { lastDayMinutes, planningConfig, returnMatch } from "./planning";
import { effectivePickup } from "./metrics";
import { checkVehicle, firstCompliant } from "./vehicle-rules";
import { DeadlinesService } from "./deadlines.service";
import { IdentityService } from "./identity.service";
import { missingDocuments, missingIdentifiers } from "./driver-docs";
import { buildJustificatif } from "./justificatif";
import { haversineKm } from "./zones";
import { AvailabilitySchema, DocumentUploadSchema, DriverLoginSchema, DriverOtpRequestSchema, LocationUpdateSchema } from "./schemas";
import { OtpService } from "./otp.service";
import { z } from "zod";
import { DriverGuard } from "./security";
import { DriverAuthService } from "./driver-auth.service";
import { LIVE_STATUSES } from "./live-position";

const ACTION_SET = new Set<DriverAction>(["en-route", "arrived", "start", "complete", "no-show"]);

function fortnightStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() <= 15 ? 1 : 16));
}

@Controller("driver")
export class DriverController {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(DispatchService) private dispatch: DispatchService,
    @Inject(OtpService) private otp: OtpService,
    @Inject(DriverAuthService) private auth: DriverAuthService,
    @Inject(IdentityService) private identityChecks: IdentityService,
    @Inject(DeadlinesService) private deadlines: DeadlinesService,
  ) {}

  /** Envoie un code à usage unique par SMS (réponse identique que le numéro soit connu ou non). */
  @Post("otp")
  requestCode(@Req() req: any, @Body() body: unknown) {
    return this.otp.request(parse(DriverOtpRequestSchema, body).phone, req.ip ?? "unknown");
  }

  @Post("login")
  async login(@Req() req: any, @Body() body: unknown) {
    const { phone, code } = parse(DriverLoginSchema, body);
    return this.auth.legacyLogin(phone,code,req.ip??"unknown");
  }

  /** Terminal de paiement par carte : simple déclaration du chauffeur, requise pour les courses payées à bord. */
  @Post("card-terminal")
  @UseGuards(DriverGuard)
  async cardTerminal(@Req() req: any, @Body() body: unknown) {
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), body);
    await this.prisma.driver.update({ where: { id: req.driverId }, data: { cardTerminal: enabled } });
    return { cardTerminal: enabled };
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
      rating: d.rating, cardTerminal: d.cardTerminal, vehicles: d.vehicles.map((v) => ({ ...v, compliance: checkVehicle(v) })), documents: d.documents.map((x) => ({ id: x.id, type: x.type, status: x.status, expiresAt: x.expiresAt })),
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
      unreadNotifications: await this.prisma.notification.count({ where: { driverId: id, readAt: null } }),
      liveRideId: (await this.prisma.ride.findFirst({ where: { driverId: id, status: { in: ["EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } }, select: { id: true } }))?.id ?? null,
      pendingOffers: offers.length,
      potentialCents: offers.reduce((s, o) => s + this.currentPrice(o.ride, now), 0),
      fortnightEarningsCents: earned._sum.driverNetCents ?? 0,
      fatigue: await this.fatigue(id, now),
    };
  }

  /** Temps de mission des dernières 24 h, comparé au maximum du garde-fou (0 : garde-fou désactivé). */
  private async fatigue(driverId: string, now: Date) {
    const rides = await this.prisma.ride.findMany({
      where: { driverId, status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"] }, pickupAt: { gte: new Date(now.getTime() - 48 * 3600_000), lte: now } },
    });
    return { minutes24h: lastDayMinutes(rides.map((r) => this.dispatch.slotOf(r)), now.getTime()), maxMinutes: planningConfig().maxMissionHours * 60 };
  }

  /** Situation d'identité : champs d'exploitant, ce qui manque, et état du selfie de prise de service. */
  @Get("identity")
  @UseGuards(DriverGuard)
  async identityState(@Req() req: any) {
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: req.driverId }, include: { company: true } });
    return {
      attachedToCompany: !!d.companyId, companyName: d.company?.name ?? null,
      businessName: d.businessName, siret: d.siret, revtcNumber: d.revtcNumber, proCardNumber: d.proCardNumber,
      missing: await missingIdentifiers(this.prisma, d.id),
      selfie: await this.identityChecks.state(d.id),
      photo: await this.identityChecks.photo(d.id), // photo de profil : visible par le chauffeur et l'équipe ; le voyageur la voit seulement avec le consentement ci-dessous
      photoConsent: { given: !!d.photoConsentAt, at: d.photoConsentAt },
    };
  }

  /** Consentement (accept=true) ou retrait (false) : montrer sa photo au voyageur pendant la course. Révocable à tout moment. */
  @Post("identity/photo-consent")
  @UseGuards(DriverGuard)
  photoConsent(@Req() req: any, @Body() body: unknown) {
    return this.identityChecks.setPhotoConsent(req.driverId, parse(z.object({ accept: z.boolean() }), body).accept);
  }

  /** Selfie de prise de service (ou photo de référence la première fois). Image JPEG/PNG en base64, 400 Ko maximum. */
  @Post("identity/selfie")
  @UseGuards(DriverGuard)
  selfie(@Req() req: any, @Body() body: unknown) {
    const b = parse(z.object({ image: z.string().min(100).max(600_000), mime: z.enum(["image/jpeg", "image/png"]).default("image/jpeg") }), body);
    return this.identityChecks.submitSelfie(req.driverId, b.image.replace(/^data:[^,]+,/, ""), b.mime);
  }

  /** Identité d'exploitant : un indépendant la renseigne lui-même ; un chauffeur rattaché à une société ne renseigne que sa carte professionnelle. */
  @Post("identity")
  @UseGuards(DriverGuard)
  async identity(@Req() req: any, @Body() body: unknown) {
    const b = parse(z.object({
      businessName: z.string().min(1).max(200).optional(), siret: z.string().regex(/^(\d{9}|\d{14})$/).optional(),
      revtcNumber: z.string().min(3).max(40).optional(), proCardNumber: z.string().min(3).max(40).optional(),
    }), body);
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: req.driverId } });
    const data = d.companyId ? { proCardNumber: b.proCardNumber } : b;
    const u = await this.prisma.driver.update({ where: { id: d.id }, data });
    return { businessName: u.businessName, siret: u.siret, revtcNumber: u.revtcNumber, proCardNumber: u.proCardNumber };
  }

  /** Justificatif de réservation préalable, à présenter en cas de contrôle (papier ou électronique). */
  @Get("rides/:id/justificatif")
  @UseGuards(DriverGuard)
  async justificatif(@Req() req: any, @Param("id") id: string) {
    const r = await this.prisma.ride.findFirst({ where: { id, driverId: req.driverId }, include: { booking: true, driver: { include: { company: true } } } });
    if (!r) throw new HttpException("Mission introuvable", 404);
    const d = r.driver!;
    return buildJustificatif({
      operatorName: d.company ? d.company.name : d.businessName ?? `${d.firstName} ${d.lastName}`,
      revtcNumber: d.company ? d.company.vtcRegistry : d.revtcNumber, siret: d.company ? d.company.siret : d.siret,
      clientName: `${r.booking.passengerFirstName} ${r.booking.passengerLastName}`, clientPhone: r.booking.passengerPhone,
      reservedAt: r.booking.createdAt, pickupAt: r.pickupAt, pickupAddress: r.pickupAddress, ref: r.ref,
    });
  }

  /** Échéances des documents obligatoires (valable, bientôt expiré, expiré, manquant, en attente de validation). */
  @Get("deadlines")
  @UseGuards(DriverGuard)
  deadlinesList(@Req() req: any) { return this.deadlines.list(req.driverId); }

  @Post("availability")
  @UseGuards(DriverGuard)
  async availability(@Req() req: any, @Body() body: unknown) {
    const { availability } = parse(AvailabilitySchema, body);
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: req.driverId } });
    if (d.status !== "ACTIVE") throw new HttpException("Compte non actif", 403);
    if (availability === "AVAILABLE") {
      const expired = await missingDocuments(this.prisma, d.id);
      if (expired.length) throw new HttpException({ message: "Document manquant ou expiré : renouvelez-le pour vous mettre en ligne", code: "DOCUMENTS_EXPIRED", missing: expired }, 403);
      const blocked = await this.identityChecks.blockReason(d.id);
      if (blocked) throw new HttpException({ message: blocked, code: "IDENTITY_CHECK_REQUIRED" }, 403);
    }
    await this.prisma.driver.update({ where: { id: d.id }, data: { availability } });
    return { availability };
  }

  @Post("location")
  @UseGuards(DriverGuard)
  async location(@Req() req: any, @Body() body: unknown) {
    const { lat, lng } = parse(LocationUpdateSchema, body);
    await this.prisma.driver.update({ where: { id: req.driverId }, data: { lastLat: lat, lastLng: lng, lastSeenAt: new Date() } });
    // « live » indique au téléphone s'il doit continuer le partage en arrière-plan (mission en cours) ou l'arrêter.
    const live = await this.prisma.ride.count({ where: { driverId: req.driverId, status: { in: [...LIVE_STATUSES] } } });
    return { ok: true, live: live > 0 };
  }

  @Post("documents")
  @UseGuards(DriverGuard)
  async uploadDocument(@Req() req: any, @Body() body: unknown) {
    const d = parse(DocumentUploadSchema, body);
    // Phase 1 : on enregistre la référence. Phase 2 : URL pré-signée S3 + chiffrement.
    return this.prisma.document.create({ data: { driverId: req.driverId, type: d.type, storageKey: d.storageKey, expiresAt: d.expiresAt ? new Date(d.expiresAt) : null } });
  }

  /** Prix actuellement proposé pour une mission non attribuée (échelle de prix : il monte à l'approche de la prise en charge). */
  private currentPrice(ride: { driverCapCents: number; driverNetCents: number; pickupAt: Date; flightDelayMin: number }, now: Date) {
    const cap = ride.driverCapCents > 0 ? ride.driverCapCents : ride.driverNetCents;
    return driverOfferCents(cap, effectivePickup(ride.pickupAt, ride.flightDelayMin), now);
  }

  /** Courses à prendre : le passager n'est PAS divulgué avant l'acceptation. */
  @Get("offers")
  @UseGuards(DriverGuard)
  async offers(@Req() req: any) {
    const now = new Date();
    const me = await this.prisma.driver.findUnique({ where: { id: req.driverId }, select: { lastLat: true, lastLng: true, vehicles: { where: { active: true } } } });
    const distTo = (lat: number, lng: number) =>
      me?.lastLat != null && me.lastLng != null ? Math.round(haversineKm({ lat: me.lastLat, lng: me.lastLng }, { lat, lng }) * 10) / 10 : null;
    const offers = await this.prisma.dispatchOffer.findMany({
      where: { driverId: req.driverId, status: "PENDING", expiresAt: { gt: now }, ride: { status: "DISPATCHING" } },
      include: { ride: { include: { booking: { include: { partner: true } } } } },
      orderBy: { ride: { pickupAt: "asc" } },
    });
    // Missions de retour : offres qui partent près de la fin d'une mission déjà prévue, peu après.
    const mine = await this.prisma.ride.findMany({ where: { driverId: req.driverId, status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } } });
    const planned = this.dispatch.planned(mine);
    const list = offers.map((o) => {
      // Prime écologique : annoncée avant l'acceptation, avec le véhicule qui servirait à la mission.
      const price = this.currentPrice(o.ride, now);
      const fuel = firstCompliant(me?.vehicles ?? [], o.ride.category, o.ride.needs)?.fuel;
      const eco = ecoBonusCents(fuel, o.ride.priceCents, o.ride.priceCents - price);
      return {
      offerId: o.id,
      expiresAt: o.expiresAt,
      secondsLeft: Math.max(0, Math.round((o.expiresAt.getTime() - now.getTime()) / 1000)),
      pickupAt: o.ride.pickupAt, category: o.ride.category,
      partner: o.ride.booking.partner?.name ?? null,
      pickup: o.ride.pickupAddress, dropoff: o.ride.dropoffAddress,
      pickupDistanceKm: distTo(o.ride.pickupLat, o.ride.pickupLng),
      distanceKm: Math.round(o.ride.distanceKm * 10) / 10, durationMin: Math.round(o.ride.durationMin),
      // Prix du moment : il peut monter d'ici l'acceptation, jamais baisser. Le prix accepté est celui de l'instant de l'acceptation.
      netCents: price + eco,
      ecoBonusCents: eco,
      priceRising: price < (o.ride.driverCapCents > 0 ? o.ride.driverCapCents : o.ride.driverNetCents),
      netPerHourCents: Math.round((price + eco) / Math.max(o.ride.durationMin / 60, 0.25)),
      flightNumber: o.ride.booking.flightNumber,
      needs: o.ride.needs,
      payOnBoard: o.ride.payOnBoard ? { collectCents: o.ride.priceCents } : null,
      returnTrip: returnMatch(planned, { pickupLat: o.ride.pickupLat, pickupLng: o.ride.pickupLng, startAt: this.dispatch.slotOf(o.ride).start }),
    };
    });
    return [...list.filter((o) => o.returnTrip), ...list.filter((o) => !o.returnTrip)];
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
        status: upcoming ? { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } : { in: ["COMPLETED", "NO_SHOW", "DISPUTED", "REFUNDED", "CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT"] },
      },
      include: { booking: { include: { partner: true } }, vehicle: true, driver: true, events: { where: { type: "ride.arrived" }, orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { pickupAt: upcoming ? "asc" : "desc" },
      take: 100,
    });
    return rides.map((r) => driverRideView(r, r.events[0]?.createdAt ?? null));
  }

  /** Messages du chauffeur (annulations, retards de vol, attributions), du plus récent au plus ancien. */
  @Get("notifications")
  @UseGuards(DriverGuard)
  async notifications(@Req() req: any) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { driverId: req.driverId }, orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.notification.count({ where: { driverId: req.driverId, readAt: null } }),
    ]);
    return { unread, items };
  }

  /** Marque des messages comme lus (sans `ids` : tous). Ne touche jamais aux messages d'un autre chauffeur. */
  @Post("notifications/read")
  @UseGuards(DriverGuard)
  async markRead(@Req() req: any, @Body() body: unknown) {
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).max(100).optional() }), body ?? {});
    const r = await this.prisma.notification.updateMany({ where: { driverId: req.driverId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return { marked: r.count };
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
