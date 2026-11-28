import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Partner } from "@prisma/client";
import { NEEDS, VehicleCategorySchema } from "@vtc/shared";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { BookingsService } from "./bookings.service";
import { SlidingLimiter } from "./hardening";
import { parse } from "./http";
import { PrismaService } from "./prisma";
import { QuotesService } from "./quotes.service";
import { AdminGuard, AdminOnly } from "./security";

/**
 * Page de réservation clé en main. Pourquoi : beaucoup de petits hôtels et agences n'ont personne pour brancher une API.
 * CliCab héberge une page à leur nom ; la réservation est créée au compte du partenaire, exactement comme par l'API
 * (même prix, même facturation). Trajets proposés : entre l'adresse du partenaire et une liste d'aéroports et de gares,
 * faute de recherche d'adresses (géocodage) dans le projet.
 * Coordonnées des lieux : points approximatifs (centre du terminal ou de la gare), À VÉRIFIER avant mise en ligne ;
 * le chauffeur dispose aussi du libellé et des consignes.
 */
export const HUBS = [
  { id: "CDG-T1", label: "Aéroport Paris-Charles de Gaulle, Terminal 1", lat: 49.0147, lng: 2.542, airport: true },
  { id: "CDG-T2", label: "Aéroport Paris-Charles de Gaulle, Terminal 2", lat: 49.0097, lng: 2.5479, airport: true },
  { id: "ORY", label: "Aéroport Paris-Orly", lat: 48.7262, lng: 2.3652, airport: true },
  { id: "BVA", label: "Aéroport Paris-Beauvais", lat: 49.4547, lng: 2.1128, airport: true },
  { id: "GARE-NORD", label: "Gare du Nord, Paris", lat: 48.8809, lng: 2.3553, airport: false },
  { id: "GARE-LYON", label: "Gare de Lyon, Paris", lat: 48.8443, lng: 2.3744, airport: false },
  { id: "GARE-MONTPARNASSE", label: "Gare Montparnasse, Paris", lat: 48.8412, lng: 2.3203, airport: false },
  { id: "GARE-EST", label: "Gare de l'Est, Paris", lat: 48.8768, lng: 2.3592, airport: false },
  { id: "GARE-SAINT-LAZARE", label: "Gare Saint-Lazare, Paris", lat: 48.8763, lng: 2.3254, airport: false },
] as const;
const HUB_IDS = HUBS.map((h) => h.id) as [string, ...string[]];

const hash = (s: string) => createHash("sha256").update(s.trim()).digest();
export function codeMatches(storedHex: string | null, given: string | undefined) {
  if (!storedHex) return true;
  if (!given) return false;
  const a = Buffer.from(storedHex, "hex"), b = hash(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const TripSchema = z.object({
  hub: z.enum(HUB_IDS),
  direction: z.enum(["FROM_HUB", "TO_HUB"]),
  pickupAt: z.string().datetime(),
  category: VehicleCategorySchema,
  passengers: z.number().int().min(1).max(8),
  luggage: z.number().int().min(0).max(12).default(0),
  flightNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2}\d{1,4}$/, "numéro de vol au format AF1234").optional(),
  code: z.string().max(64).optional(),
});
export const BookSchema = z.object({
  quoteId: z.string().uuid(),
  code: z.string().max(64).optional(),
  notes: z.string().max(300).optional(),
  needs: z.array(z.enum(NEEDS)).max(NEEDS.length).optional(),
  payOnBoard: z.boolean().optional(),
  passenger: z.object({
    firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60),
    phone: z.string().trim().regex(/^\+?[0-9 .-]{6,20}$/, "numéro de téléphone invalide"), email: z.string().email().optional(),
    language: z.enum(["fr", "en"]).default("fr"),
  }),
  // Le voyageur accepte que ses coordonnées servent à organiser le trajet (minimum légal à faire valider).
  consent: z.literal(true, { errorMap: () => ({ message: "accord requis" }) }),
});

@Injectable()
export class HostedService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(QuotesService) private quotes: QuotesService,
    @Inject(BookingsService) private bookings: BookingsService,
  ) {}

  private async partner(slug: string) {
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new HttpException("Page introuvable", 404);
    const p = await this.prisma.partner.findUnique({ where: { hostedSlug: slug } });
    if (!p || !p.active || !p.hostedEnabled || p.hostedLat == null || p.hostedLng == null || !p.hostedAddress) throw new HttpException("Page introuvable", 404);
    return p;
  }
  private checkCode(p: Partner, code?: string) {
    if (!codeMatches(p.hostedCodeHash, code)) throw new HttpException({ message: "Code d'accès incorrect", code: "ACCESS_CODE" }, 403);
  }

  async info(slug: string) {
    const p = await this.partner(slug);
    return { name: p.name, place: { label: p.hostedPlaceLabel ?? p.name, address: p.hostedAddress }, needsCode: !!p.hostedCodeHash, hubs: HUBS.map(({ id, label, airport }) => ({ id, label, airport })), categories: VehicleCategorySchema.options, needs: NEEDS };
  }

  async quote(slug: string, body: unknown) {
    const p = await this.partner(slug);
    const t = parse(TripSchema, body);
    this.checkCode(p, t.code);
    return this.tripQuote(p, t);
  }

  /** Devis entre l'adresse du partenaire et un aéroport ou une gare (page publique et espace hôtel). */
  async tripQuote(p: Partner, t: z.infer<typeof TripSchema>) {
    if (p.hostedLat == null || p.hostedLng == null || !p.hostedAddress) throw new HttpException("Adresse de l'établissement non renseignée : à saisir dans la tour de contrôle (Partenaires, pages de réservation)", 409);
    const hub = HUBS.find((h) => h.id === t.hub)!;
    if (t.flightNumber && !hub.airport) throw new HttpException({ errors: { flightNumber: ["seulement pour un aéroport"] } }, 422);
    const home = { address: p.hostedAddress!, lat: p.hostedLat!, lng: p.hostedLng! };
    const spot = { address: hub.label, lat: hub.lat, lng: hub.lng };
    const [pickup, dropoff] = t.direction === "FROM_HUB" ? [spot, home] : [home, spot];
    const q = await this.quotes.create(p, { pickup, dropoff, pickupAt: t.pickupAt, category: t.category, passengers: t.passengers, luggage: t.luggage, ...(t.flightNumber && t.direction === "FROM_HUB" ? { flightNumber: t.flightNumber } : {}) });
    return { ...q, pickup: pickup.address, dropoff: dropoff.address };
  }

  async book(slug: string, body: unknown) {
    const p = await this.partner(slug);
    const b = parse(BookSchema, body);
    this.checkCode(p, b.code);
    // Clé d'idempotence propre à chaque envoi : un double clic reste protégé par le devis à usage unique.
    const v = await this.createBooking(p, `page-${randomBytes(12).toString("hex")}`, b, "PAGE", false);
    return { reference: v.reference, pickupAt: v.pickupAt, pickup: v.pickup.address, dropoff: v.dropoff.address, total: v.total, currency: v.currency, trackingUrl: v.trackingUrl };
  }

  async createBooking(p: Partner, key: string, b: z.infer<typeof BookSchema>, externalReference: string, sandbox: boolean) {
    const res = await this.bookings.create(p, key, {
      quoteId: b.quoteId, externalReference, notes: b.notes, needs: b.needs, payOnBoard: b.payOnBoard,
      passenger: { firstName: b.passenger.firstName, lastName: b.passenger.lastName, phone: b.passenger.phone, email: b.passenger.email, language: b.passenger.language },
    }, sandbox);
    return res.booking as any;
  }

  /** Liste pour l'équipe, avec l'adresse publique de la page (même domaine que le suivi voyageur). */
  async list() {
    const base = (process.env.TRACKING_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
    const rows = await this.prisma.partner.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((p) => ({
      id: p.id, name: p.name, active: p.active, hosted: {
        enabled: p.hostedEnabled, slug: p.hostedSlug, placeLabel: p.hostedPlaceLabel, address: p.hostedAddress, lat: p.hostedLat, lng: p.hostedLng, needsCode: !!p.hostedCodeHash,
        url: p.hostedSlug ? `${base}/reserver/${p.hostedSlug}` : null,
      },
    }));
  }

  async configure(partnerId: string, actor: string, c: { enabled: boolean; slug: string; placeLabel: string; address: string; lat: number; lng: number; accessCode?: string | null }) {
    const clash = await this.prisma.partner.findFirst({ where: { hostedSlug: c.slug, id: { not: partnerId } }, select: { id: true } });
    if (clash) throw new HttpException({ errors: { slug: ["déjà utilisée"] } }, 409);
    const p = await this.prisma.partner.update({
      where: { id: partnerId },
      data: {
        hostedEnabled: c.enabled, hostedSlug: c.slug, hostedPlaceLabel: c.placeLabel, hostedAddress: c.address, hostedLat: c.lat, hostedLng: c.lng,
        ...(c.accessCode === null ? { hostedCodeHash: null } : c.accessCode ? { hostedCodeHash: hash(c.accessCode).toString("hex") } : {}),
      },
    });
    await this.prisma.auditLog.create({ data: { actor, action: "partner.hosted_page", entity: "Partner", entityId: partnerId, data: { enabled: c.enabled, slug: c.slug } as any } });
    return { enabled: p.hostedEnabled, slug: p.hostedSlug, needsCode: !!p.hostedCodeHash };
  }
}

/** Public, sans compte : limité par adresse IP (devis et réservations). */
@Controller("public/book")
export class PublicBookingController {
  private limiter = new SlidingLimiter();
  constructor(@Inject(HostedService) private svc: HostedService) {}
  private throttle(req: any, n: number) {
    if (!this.limiter.allow(`${req.ip ?? "?"}:${n}`, Number(process.env.HOSTED_IP_PER_HOUR) || n, 3600_000)) throw new HttpException("Trop de demandes, réessayez plus tard", 429);
  }
  @Get(":slug") info(@Param("slug") slug: string) { return this.svc.info(slug); }
  @Post(":slug/quote") quote(@Param("slug") slug: string, @Req() req: any, @Body() body: unknown) { this.throttle(req, 60); return this.svc.quote(slug, body); }
  @Post(":slug/booking") book(@Param("slug") slug: string, @Req() req: any, @Body() body: unknown) { this.throttle(req, 10); return this.svc.book(slug, body); }
}

@Controller("admin/partners")
@UseGuards(AdminGuard)
export class AdminHostedController {
  constructor(@Inject(HostedService) private svc: HostedService) {}
  @Get() list() { return this.svc.list(); }
  @Post(":id/hosted") @AdminOnly() configure(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.configure(id, req.admin.actor, parse(z.object({
      enabled: z.boolean(), slug: z.string().regex(/^[a-z0-9-]{3,40}$/, "minuscules, chiffres et tirets (3 à 40)"),
      placeLabel: z.string().trim().min(2).max(80), address: z.string().trim().min(5).max(200),
      lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
      accessCode: z.string().trim().min(4).max(64).nullable().optional(),
    }), body));
  }
}
