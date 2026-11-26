import { manualAssignment } from "../test/manual-assignment";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { lostItemOpen } from "./lost-items";

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
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `B${n}`, lastName: "Test", phone: `+3360005${String(n).padStart(4, "0")}`, email: `b${n}@test.fr`, vehicle: { plate: `LI-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE", ...(features ? { features } : {}) } } });
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

describe("délai de signalement", () => {
  it("ouvert 7 jours après la fin du trajet", () => {
    const now = new Date("2026-06-10T10:00:00Z");
    expect(lostItemOpen(new Date("2026-06-03T10:00:00Z"), now, 7)).toBe(true);
    expect(lostItemOpen(new Date("2026-06-03T09:00:00Z"), now, 7)).toBe(false);
    expect(lostItemOpen(null, now, 7)).toBe(false);
  });
});

describe("objet oublié", () => {
  async function done() {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const d = await mkDriver();
    const b = await book(p);
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
    await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, d.id));
    const token = b.json.trackingUrl.split("/suivi/")[1] as string;
    return { d, ride, token };
  }

  it("le voyageur signale, le chauffeur répond, l'équipe clôt ; le voyageur ne voit jamais les coordonnées du chauffeur", async () => {
    const { d, ride, token } = await done();
    // Pas avant la fin du trajet
    expect((await call(`/track/${token}/lost-item`, { body: { description: "Écharpe bleue" } })).status).toBe(409);
    expect((await call(`/track/${token}`)).json.lostItem).toBeNull();
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "COMPLETED" } });
    await prisma.rideEvent.create({ data: { rideId: ride.id, type: "ride.completed", actor: `driver:${d.id}` } });
    expect((await call(`/track/${token}`)).json.lostItem).toMatchObject({ canReport: true, days: 7, last: null });
    expect((await call(`/track/${token}/lost-item`, { body: { description: "x" } })).status).toBe(422);
    const r = await call(`/track/${token}/lost-item`, { body: { description: "Écharpe bleue, siège arrière" } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("OPEN");
    expect((await call(`/track/${token}/lost-item`, { body: { description: "Encore" } })).status).toBe(409); // un seul à la fois
    expect(await prisma.notification.count({ where: { driverId: d.id, type: "LOST_ITEM" } })).toBe(1);
    const mine = (await call("/driver/lost-items", { token: d.token })).json;
    expect(mine).toHaveLength(1);
    expect(mine[0].description).toMatch(/Écharpe/);
    // Un autre chauffeur ne peut pas répondre
    const other = await mkDriver();
    expect((await call(`/driver/lost-items/${mine[0].id}/answer`, { token: other.token, body: { found: true } })).status).toBe(404);
    expect((await call(`/driver/lost-items/${mine[0].id}/answer`, { token: d.token, body: { found: true, note: "Dans la boîte à gants" } })).status).toBe(201);
    const track = (await call(`/track/${token}`)).json;
    expect(track.lostItem.last.status).toBe("FOUND");
    expect(track.lostItem.canReport).toBe(false);
    expect(JSON.stringify(track)).not.toMatch(/\+3360005/); // aucun téléphone de chauffeur
    const admin = (await call("/admin/lost-items", { admin: true })).json;
    expect(admin[0]).toMatchObject({ status: "FOUND", driverNote: "Dans la boîte à gants", ref: ride.ref });
    expect((await call(`/admin/lost-items/${mine[0].id}/close`, { admin: true, body: { status: "RETURNED" } })).status).toBe(201);
    expect((await call(`/track/${token}`)).json.lostItem.last.status).toBe("RETURNED");
    expect(await prisma.auditLog.count({ where: { action: "lost_item.returned" } })).toBe(1);
  });

  it("refusé après le délai", async () => {
    const { ride, token } = await done();
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "COMPLETED" } });
    await prisma.rideEvent.create({ data: { rideId: ride.id, type: "ride.completed", actor: "system", createdAt: new Date(Date.now() - 8 * 86400_000) } });
    expect((await call(`/track/${token}`)).json.lostItem.canReport).toBe(false);
    const r = await call(`/track/${token}/lost-item`, { body: { description: "Parapluie" } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/7 jours/);
  });
});
