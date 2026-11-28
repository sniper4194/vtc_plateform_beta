import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GeocodeService } from "./geocode";
import { AppModule } from "./app.module";
import { codeMatches } from "./hosted";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;

async function call(path: string, opts: { token?: string; admin?: boolean; body?: unknown; headers?: Record<string, string>; method?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.admin ? { "x-admin-token": "test-admin-token-test-admin-token" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "MeetingPoint","RideProof","Incident","IdentityCheck","DriverPenalty","RescueRequest","Notification","OtpCode","WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE');
});

const CDG = { address: "Aéroport CDG T2", lat: 49.0097, lng: 2.5479 };
const PARIS = { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 };
let n = 0;
async function mkDriver(features?: string[]) {
  n++;
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `B${n}`, lastName: "Test", phone: `+3360009${String(n).padStart(4, "0")}`, email: `b${n}@test.fr`, vehicle: { plate: `HB-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE", ...(features ? { features } : {}) } } });
  expect(r.status).toBe(201);
  const id: string = r.json.id;
  await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: `k/${type}`, status: "APPROVED" as const })) });
  await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} });
  const token: string = (await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } })).json.token;
  await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
  await call("/driver/location", { token, body: { lat: 48.86, lng: 2.35 } });
  return { id, token };
}
async function book(p: { apiKey: string }, needs?: unknown, days = 3) {
  const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: new Date(Date.now() + days * 86400_000).toISOString(), category: "BERLINE", passengers: 3, luggage: 2 } });
  return call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": `k-${Math.random()}` }, body: { quoteId: q.json.quoteId, externalReference: "BK", ...(needs !== undefined ? { needs } : {}), passenger: { firstName: "Mia", lastName: "Jensen", phone: "+4520123456", language: "en" } } });
}

describe("code d'accès", () => {
  it("facultatif ; sinon comparé sur son empreinte", () => {
    const h = createHash("sha256").update("soleil42").digest("hex");
    expect(codeMatches(null, undefined)).toBe(true);
    expect(codeMatches(h, "soleil42")).toBe(true);
    expect(codeMatches(h, " soleil42 ")).toBe(true);
    expect(codeMatches(h, "autre")).toBe(false);
    expect(codeMatches(h, undefined)).toBe(false);
  });
});

describe("page de réservation clé en main", () => {
  const at = () => new Date(Date.now() + 2 * 86400_000).toISOString();
  async function setup(accessCode?: string) {
    const p = (await call("/admin/partners", { admin: true, body: { name: "Hôtel des Tilleuls" } })).json;
    const slug = `tilleuls-${Math.floor(Math.random() * 1e6)}`;
    const c = await call(`/admin/partners/${p.partnerId ?? p.id}/hosted`, { admin: true, body: { enabled: true, slug, placeLabel: "Hôtel des Tilleuls", address: "12 rue des Tilleuls, 75011 Paris", lat: 48.8589, lng: 2.3802, ...(accessCode ? { accessCode } : {}) } });
    expect(c.status).toBe(201);
    return { p, slug };
  }

  it("devis puis réservation au compte du partenaire, sans clé d'API ; visible par le partenaire", async () => {
    const { p, slug } = await setup();
    const info = (await call(`/public/book/${slug}`)).json;
    expect(info).toMatchObject({ name: "Hôtel des Tilleuls", needsCode: false });
    expect(info.hubs.length).toBeGreaterThan(3);
    expect(JSON.stringify(info)).not.toMatch(/apiKey|lat/);
    const q = await call(`/public/book/${slug}/quote`, { body: { hub: "CDG-T2", direction: "FROM_HUB", pickupAt: at(), category: "BERLINE", passengers: 2, luggage: 2, flightNumber: "af1234" } });
    expect(q.status).toBe(201);
    expect(q.json.pickup).toMatch(/Terminal 2/);
    expect(q.json.dropoff).toMatch(/Tilleuls/);
    // Vol interdit vers une gare
    expect((await call(`/public/book/${slug}/quote`, { body: { hub: "GARE-LYON", direction: "FROM_HUB", pickupAt: at(), category: "BERLINE", passengers: 1, flightNumber: "AF1" } })).status).toBe(422);
    // Accord obligatoire
    const pass = { firstName: "Nadia", lastName: "Kowalski", phone: "+33612345678", language: "fr" };
    expect((await call(`/public/book/${slug}/booking`, { body: { quoteId: q.json.quoteId, passenger: pass } })).status).toBe(422);
    const b = await call(`/public/book/${slug}/booking`, { body: { quoteId: q.json.quoteId, passenger: pass, consent: true, needs: ["CHILD_SEAT"] } });
    expect(b.status).toBe(201);
    expect(b.json.reference).toMatch(/^R-/);
    expect(b.json.trackingUrl).toMatch(/\/suivi\//);
    // Même devis : refusé (pas de double réservation)
    expect((await call(`/public/book/${slug}/booking`, { body: { quoteId: q.json.quoteId, passenger: pass, consent: true } })).status).toBe(409);
    const booking = await prisma.booking.findFirstOrThrow({ where: { externalReference: "PAGE" }, include: { rides: true } });
    expect(booking.partnerId).toBe(p.partnerId ?? p.id);
    expect(booking.flightNumber).toBe("AF1234");
    expect(booking.rides[0].needs).toEqual(["CHILD_SEAT"]);
  });

  it("code d'accès exigé s'il est défini ; page inconnue ou désactivée : 404", async () => {
    const { p, slug } = await setup("soleil42");
    expect((await call(`/public/book/${slug}`)).json.needsCode).toBe(true);
    const listed = (await call("/admin/partners", { admin: true })).json.find((x: any) => x.hosted.slug === slug);
    expect(listed.hosted).toMatchObject({ enabled: true, needsCode: true, url: expect.stringMatching(new RegExp(`/reserver/${slug}$`)) });
    expect(JSON.stringify(listed)).not.toMatch(/soleil42|CodeHash/);
    const trip = { hub: "ORY", direction: "TO_HUB", pickupAt: at(), category: "BERLINE", passengers: 1 };
    expect((await call(`/public/book/${slug}/quote`, { body: trip })).status).toBe(403);
    expect((await call(`/public/book/${slug}/quote`, { body: { ...trip, code: "mauvais" } })).status).toBe(403);
    expect((await call(`/public/book/${slug}/quote`, { body: { ...trip, code: "soleil42" } })).status).toBe(201);
    expect((await call("/public/book/inconnue-123")).status).toBe(404);
    await call(`/admin/partners/${p.partnerId ?? p.id}/hosted`, { admin: true, body: { enabled: false, slug, placeLabel: "x y", address: "12 rue des Tilleuls", lat: 48.8, lng: 2.3 } });
    expect((await call(`/public/book/${slug}`)).status).toBe(404);
  });
});

describe("espace hôtel (réception)", () => {
  const at = (days = 2) => new Date(Date.now() + days * 86400_000).toISOString();
  async function hotel(withAddress = true) {
    const p = (await call("/admin/partners", { admin: true, body: { name: "Hôtel Les Glycines" } })).json;
    if (withAddress) {
      const c = await call(`/admin/partners/${p.partnerId}/hosted`, { admin: true, body: { enabled: false, slug: `glycines-${Math.floor(Math.random() * 1e6)}`, placeLabel: "Hôtel Les Glycines", address: "8 rue des Glycines, 75013 Paris", lat: 48.83, lng: 2.36 } });
      expect(c.status).toBe(201);
    }
    return p as { partnerId: string; apiKey: string };
  }
  const pass = { firstName: "Elena", lastName: "Moreau", phone: "+33698765432", language: "fr" };
  async function order(h: { apiKey: string }, extra: Record<string, unknown> = {}, direction = "TO_HUB") {
    const q = await call("/v1/hotel/quote", { token: h.apiKey, body: { hub: "ORY", direction, pickupAt: at(), category: "BERLINE", passengers: 2, luggage: 2 } });
    expect(q.status).toBe(201);
    return call("/v1/hotel/bookings", { token: h.apiKey, headers: { "idempotency-key": `h-${Math.random()}` }, body: { quoteId: q.json.quoteId, passenger: pass, consent: true, ...extra } });
  }

  it("refuse sans clé valide ; la page publique désactivée n'empêche pas la réception de commander", async () => {
    expect((await call("/v1/hotel/session")).status).toBe(401);
    expect((await call("/v1/hotel/session", { token: "vtc_test_inconnue" })).status).toBe(401);
    const h = await hotel();
    const s = await call("/v1/hotel/session", { token: h.apiKey });
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ name: "Hôtel Les Glycines", place: { address: "8 rue des Glycines, 75013 Paris" } });
    expect(JSON.stringify(s.json)).not.toMatch(/apiKey|"lat"/);
    const b = await order(h, { room: "214", payOnBoard: true });
    expect(b.status).toBe(201);
    expect(b.json.reference).toMatch(/^R-/);
    const ride = await prisma.ride.findFirstOrThrow({ where: { booking: { partnerId: h.partnerId } }, include: { booking: true } });
    expect(ride.booking.externalReference).toBe("Chambre 214");
    expect(ride.payOnBoard).toBe(true);
    expect(ride.pickupAddress).toMatch(/Glycines/);
    expect(ride.dropoffAddress).toMatch(/Orly/);
  });

  it("sans adresse saisie par l'équipe : commande impossible, message clair", async () => {
    const h = await hotel(false);
    expect((await call("/v1/hotel/session", { token: h.apiKey })).json.place).toBeNull();
    const q = await call("/v1/hotel/quote", { token: h.apiKey, body: { hub: "ORY", direction: "TO_HUB", pickupAt: at(), category: "BERLINE", passengers: 1 } });
    expect(q.status).toBe(409);
    expect(q.json.message).toMatch(/Adresse de l'établissement/);
  });

  it("accord du client et clé d'idempotence obligatoires ; un double envoi ne crée qu'une course", async () => {
    const h = await hotel();
    const q = await call("/v1/hotel/quote", { token: h.apiKey, body: { hub: "CDG-T2", direction: "FROM_HUB", pickupAt: at(), category: "BERLINE", passengers: 1, flightNumber: "AF1234" } });
    expect((await call("/v1/hotel/bookings", { token: h.apiKey, body: { quoteId: q.json.quoteId, passenger: pass, consent: true } })).status).toBe(400);
    expect((await call("/v1/hotel/bookings", { token: h.apiKey, headers: { "idempotency-key": "x1" }, body: { quoteId: q.json.quoteId, passenger: pass } })).status).toBe(422);
    const a = await call("/v1/hotel/bookings", { token: h.apiKey, headers: { "idempotency-key": "x2" }, body: { quoteId: q.json.quoteId, passenger: pass, consent: true } });
    const b = await call("/v1/hotel/bookings", { token: h.apiKey, headers: { "idempotency-key": "x2" }, body: { quoteId: q.json.quoteId, passenger: pass, consent: true } });
    expect(a.status).toBe(201);
    expect(b.json.id).toBe(a.json.id);
    expect(await prisma.ride.count({ where: { booking: { partnerId: h.partnerId } } })).toBe(1);
  });

  it("liste du mois : seulement les courses de cet hôtel, totaux séparés hôtel / carte à bord", async () => {
    const h = await hotel(), other = await hotel();
    await order(h, { room: "12" });
    await order(h, { payOnBoard: true });
    await order(other);
    const rides = await prisma.ride.findMany({ where: { booking: { partnerId: h.partnerId } } });
    await prisma.ride.updateMany({ where: { id: { in: rides.map((r) => r.id) } }, data: { status: "COMPLETED" } });
    await prisma.ride.updateMany({ where: { id: { in: rides.map((r) => r.id) }, payOnBoard: true }, data: { onBoardPayment: "PAID" } });
    const month = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(rides[0].pickupAt).slice(0, 7);
    const l = await call(`/v1/hotel/bookings?month=${month}`, { token: h.apiKey });
    expect(l.status).toBe(200);
    expect(l.json.rows).toHaveLength(2);
    expect(l.json.rows.map((r: any) => r.passenger)).toEqual(["Elena Moreau", "Elena Moreau"]);
    const sum = (cents: number[]) => cents.reduce((a, b) => a + b, 0) / 100;
    expect(l.json.totals.billed).toBe(sum(rides.filter((r) => !r.payOnBoard).map((r) => r.priceCents)));
    expect(l.json.totals.onBoard).toBe(sum(rides.filter((r) => r.payOnBoard).map((r) => r.priceCents)));
    expect(l.json.totals.unpaidOnBoard).toBe(0);
    expect(l.json.rows.find((r: any) => r.payOnBoard).onBoardPayment).toEqual({ status: "PAID", reason: null, resolved: false });
    expect((await call("/v1/hotel/bookings?month=2026-13", { token: h.apiKey })).status).toBe(422);
    // Annulation par la réception : même règle que l'API partenaire ; impossible sur la course d'un autre hôtel.
    const otherBooking = await prisma.booking.findFirstOrThrow({ where: { partnerId: other.partnerId } });
    expect((await call(`/v1/bookings/${otherBooking.id}`, { token: h.apiKey, method: "DELETE" })).status).toBe(404);
  });
});

describe("bornes d'un mois en heure de Paris", () => {
  it("hiver et passage d'année", async () => {
    const { monthBounds } = await import("./hotel-portal");
    expect(monthBounds("2026-12")).toEqual({ from: new Date("2026-11-30T23:00:00Z"), to: new Date("2026-12-31T23:00:00Z") });
    expect(monthBounds("2026-07").from).toEqual(new Date("2026-06-30T22:00:00Z"));
  });
});

describe("gammes CliCab des partenaires", () => {
  it("choisie à la création ou ensuite ; visible au tableau ; valeur inconnue refusée", async () => {
    const h = (await call("/admin/partners", { admin: true, body: { name: "Hôtel Le Belvédère", range: "HOTEL" } })).json;
    const g = (await call("/admin/partners", { admin: true, body: { name: "Garage Martin" } })).json;
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: h.partnerId } })).range).toBe("HOTEL");
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: g.partnerId } })).range).toBeNull();
    expect((await call(`/admin/partners/${g.partnerId}/range`, { admin: true, body: { range: "DEPANNAGE" } })).status).toBe(201);
    expect((await call(`/admin/partners/${g.partnerId}/range`, { admin: true, body: { range: "TAXI" } })).status).toBe(422);
    expect((await call("/admin/partners", { admin: true, body: { name: "X", range: "SPA" } })).status).toBe(422);
    const list = (await call("/admin/partners", { admin: true })).json;
    expect(list.find((p: any) => p.id === g.partnerId).range).toBe("DEPANNAGE");
    // Le tableau du dispatcheur reçoit la gamme avec la course.
    const q = await call("/v1/quotes", { token: g.apiKey, body: { pickup: PARIS, dropoff: CDG, pickupAt: new Date(Date.now() + 2 * 86400_000).toISOString(), category: "BERLINE", passengers: 1 } });
    await call("/v1/bookings", { token: g.apiKey, headers: { "idempotency-key": "g1" }, body: { quoteId: q.json.quoteId, passenger: { firstName: "Tomás", lastName: "Ferreira", phone: "+33612000111" } } });
    const rides = (await call("/admin/rides", { admin: true })).json;
    expect(rides[0].booking.partner.range).toBe("DEPANNAGE");
    expect((await call(`/admin/partners/${g.partnerId}/range`, { admin: true, body: { range: null } })).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: "partner.range" } })).toBe(2);
  });
});

describe("espace de commande adapté à la gamme", () => {
  const places: Record<string, { lat: number; lng: number; label: string }> = {
    "12 rue des lilas creteil": { lat: 48.79, lng: 2.455, label: "12 Rue des Lilas 94000 Créteil" },
    "hopital saint-louis paris": { lat: 48.874, lng: 2.369, label: "1 Avenue Claude Vellefaux 75010 Paris" },
    "8 rue de la paix paris": { lat: 48.869, lng: 2.331, label: "8 Rue de la Paix 75002 Paris" },
  };
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(GeocodeService.prototype, "find").mockImplementation(async (a: string) => places[a.toLowerCase()] ?? null);
  });
  afterEach(() => spy.mockRestore());
  const pass = { firstName: "Yuki", lastName: "Sato", phone: "+33677889900", language: "fr" };
  async function partnerOf(range: string) {
    return (await call("/admin/partners", { admin: true, body: { name: `Partenaire ${range}`, range } })).json as { partnerId: string; apiKey: string };
  }

  it("Dépannage : adresses libres, « dès que possible », dossier et immatriculation transmis au chauffeur", async () => {
    const g = await partnerOf("DEPANNAGE");
    const s = (await call("/v1/hotel/session", { token: g.apiKey })).json;
    expect(s).toMatchObject({ range: "DEPANNAGE", space: "Espace dépannage", addressMode: "free", features: { asap: true, caseNumber: true, returnTrip: false } });
    expect((await call("/v1/hotel/quote", { token: g.apiKey, body: { pickupAddress: "nulle part du tout", dropoffAddress: "8 rue de la Paix Paris", asap: true, category: "BERLINE", passengers: 1 } })).status).toBe(422);
    const d = await mkDriver();
    const q = await call("/v1/hotel/quote", { token: g.apiKey, body: { pickupAddress: "12 rue des Lilas Creteil", dropoffAddress: "8 rue de la Paix Paris", asap: true, category: "BERLINE", passengers: 2 } });
    expect(q.status).toBe(201);
    expect(q.json.pickup).toBe("12 Rue des Lilas 94000 Créteil");
    const minutes = (new Date(q.json.pickupAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(18); expect(minutes).toBeLessThan(21);
    // Un champ d'une autre gamme est refusé.
    expect((await call("/v1/hotel/bookings", { token: g.apiKey, headers: { "idempotency-key": "d0" }, body: { quoteId: q.json.quoteId, passenger: pass, consent: true, details: { department: "Radiologie" } } })).status).toBe(422);
    const b = await call("/v1/hotel/bookings", { token: g.apiKey, headers: { "idempotency-key": "d1" }, body: { quoteId: q.json.quoteId, passenger: pass, consent: true, asap: true, details: { caseNumber: "SIN-2026-118", brokenPlate: "gh-482-kt" } } });
    expect(b.status).toBe(201);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.json.id } });
    expect(booking.externalReference).toBe("Dossier SIN-2026-118");
    expect(booking.details).toEqual({ caseNumber: "SIN-2026-118", brokenPlate: "GH-482-KT", asap: true });
    const offer = (await call("/driver/offers", { token: d.token })).json[0];
    expect(offer.range).toBe("CliCab Dépannage");
    expect(offer.instructions).toEqual(["Urgence : le client attend, partez dès que possible", "Dossier n° SIN-2026-118", "Véhicule en panne : GH-482-KT"]);
  });

  it("Care : aller-retour en une commande, accompagnant, service ; le retour part de l'arrivée", async () => {
    const c = await partnerOf("CARE");
    const at = new Date(Date.now() + 2 * 86400_000);
    const base = { pickupAddress: "12 rue des Lilas Creteil", dropoffAddress: "Hopital Saint-Louis Paris", pickupAt: at.toISOString(), category: "BERLINE", passengers: 2 };
    expect((await call("/v1/hotel/quote", { token: c.apiKey, body: { ...base, returnAt: new Date(at.getTime() + 5 * 60_000).toISOString() } })).status).toBe(422);
    expect((await call("/v1/hotel/quote", { token: c.apiKey, body: { ...base, pickupAt: undefined, asap: true } })).status).toBe(422);
    const q = await call("/v1/hotel/quote", { token: c.apiKey, body: { ...base, returnAt: new Date(at.getTime() + 3 * 3600_000).toISOString() } });
    expect(q.status).toBe(201);
    expect(q.json.return.quoteId).toBeTruthy();
    const b = await call("/v1/hotel/bookings", { token: c.apiKey, headers: { "idempotency-key": "c1" }, body: { quoteId: q.json.quoteId, returnQuoteId: q.json.return.quoteId, passenger: pass, consent: true, details: { department: "Cardiologie, 3e étage", escorts: 1, walkingAssist: true } } });
    expect(b.status).toBe(201);
    expect(b.json.return.reference).toMatch(/^R-/);
    const again = await call("/v1/hotel/bookings", { token: c.apiKey, headers: { "idempotency-key": "c1" }, body: { quoteId: q.json.quoteId, returnQuoteId: q.json.return.quoteId, passenger: pass, consent: true, details: { department: "Cardiologie, 3e étage", escorts: 1, walkingAssist: true } } });
    expect(again.json.return.id).toBe(b.json.return.id);
    const rides = await prisma.ride.findMany({ where: { booking: { partnerId: c.partnerId } }, include: { booking: true }, orderBy: { pickupAt: "asc" } });
    expect(rides).toHaveLength(2);
    expect(rides[0].pickupAddress).toBe("12 Rue des Lilas 94000 Créteil");
    expect(rides[1].pickupAddress).toBe("1 Avenue Claude Vellefaux 75010 Paris");
    expect((rides[1].booking.details as any).leg).toBe("RETOUR");
    // Hôtel : pas d'aller-retour, pas de champ d'une autre gamme.
    const h = await partnerOf("HOTEL");
    expect((await call("/v1/hotel/quote", { token: h.apiKey, body: { ...base, returnAt: new Date(at.getTime() + 3 * 3600_000).toISOString() } })).status).toBe(422);
  });
});

describe("suppression d'un partenaire", () => {
  it("sans réservation : effacé ; avec réservations : désactivé (clé refusée, historique gardé), puis réactivable", async () => {
    const empty = (await call("/admin/partners", { admin: true, body: { name: "Essai vide" } })).json;
    expect((await call(`/admin/partners/${empty.partnerId}`, { admin: true, method: "DELETE" })).json).toEqual({ result: "DELETED" });
    expect(await prisma.partner.count({ where: { id: empty.partnerId } })).toBe(0);
    expect((await call("/v1/hotel/session", { token: empty.apiKey })).status).toBe(401);
    const used = (await call("/admin/partners", { admin: true, body: { name: "Hôtel du Parc" } })).json;
    const q = await call("/v1/quotes", { token: used.apiKey, body: { pickup: PARIS, dropoff: CDG, pickupAt: new Date(Date.now() + 2 * 86400_000).toISOString(), category: "BERLINE", passengers: 1 } });
    await call("/v1/bookings", { token: used.apiKey, headers: { "idempotency-key": "p1" }, body: { quoteId: q.json.quoteId, passenger: { firstName: "Ines", lastName: "Varga", phone: "+33612000222" } } });
    const r = await call(`/admin/partners/${used.partnerId}`, { admin: true, method: "DELETE" });
    expect(r.json).toEqual({ result: "DEACTIVATED", bookings: 1 });
    expect(await prisma.booking.count({ where: { partnerId: used.partnerId } })).toBe(1);
    expect((await call("/v1/hotel/session", { token: used.apiKey })).status).toBe(401);
    expect((await call(`/admin/partners/${used.partnerId}/reactivate`, { admin: true, body: {} })).status).toBe(201);
    expect((await call("/v1/hotel/session", { token: used.apiKey })).status).toBe(200);
    expect((await call(`/admin/partners/${used.partnerId}/reactivate`, { admin: true, body: {} })).status).toBe(409);
    expect((await call("/admin/partners/00000000-0000-0000-0000-000000000000", { admin: true, method: "DELETE" })).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: { in: ["partner.deleted", "partner.deactivated", "partner.reactivated"] } } })).toBe(3);
  });
});
