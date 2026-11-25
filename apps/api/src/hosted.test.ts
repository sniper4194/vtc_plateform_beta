import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
