import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { swapOpen } from "./swap";

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
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `B${n}`, lastName: "Test", phone: `+3360004${String(n).padStart(4, "0")}`, email: `b${n}@test.fr`, vehicle: { plate: `SW-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE", ...(features ? { features } : {}) } } });
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

describe("délai d'échange", () => {
  it("ouvert jusqu'à 48 h avant la prise en charge", () => {
    const now = new Date("2026-06-01T10:00:00Z");
    expect(swapOpen(new Date("2026-06-03T10:00:00Z"), now, 48)).toBe(true);
    expect(swapOpen(new Date("2026-06-03T09:59:00Z"), now, 48)).toBe(false);
  });
});

describe("bourse d'échange entre chauffeurs", () => {
  async function assigned(days = 3, needs?: string[]) {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const owner = await mkDriver(needs);
    const b = await book(p, needs, days);
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
    expect((await call(`/admin/rides/${ride.id}/assign`, { admin: true, body: { driverId: owner.id } })).status).toBe(201);
    return { owner, ride: await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } }) };
  }

  it("un collègue éligible reprend la mission, sans pénalité, au même prix", async () => {
    const { owner, ride } = await assigned();
    const mate = await mkDriver();
    expect((await call("/driver/swaps", { token: mate.token })).json).toEqual([]);
    const o = await call(`/driver/rides/${ride.id}/swap`, { token: owner.token, body: {} });
    expect(o.status).toBe(201);
    const v = (await call(`/driver/rides/${ride.id}`, { token: owner.token })).json;
    expect(v.swapOfferedAt).toBeTruthy();
    expect(new Date(v.swapDeadline).getTime()).toBe(ride.pickupAt.getTime() - 48 * 3600_000);
    const board = (await call("/driver/swaps", { token: mate.token })).json;
    expect(board).toHaveLength(1);
    expect(board[0].driverNetCents).toBe(ride.driverNetCents - ride.ecoBonusCents);
    expect((await call("/driver/swaps", { token: owner.token })).json).toEqual([]); // pas sa propre mission
    const t = await call(`/driver/swaps/${ride.id}/take`, { token: mate.token, body: {} });
    expect(t.status).toBe(201);
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.driverId).toBe(mate.id);
    expect(after.status).toBe("ASSIGNED");
    expect(after.swapOfferedAt).toBeNull();
    expect(after.driverNetCents).toBe(ride.driverNetCents);
    expect(await prisma.driverPenalty.count({ where: { driverId: owner.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { driverId: owner.id, type: "SWAP_TAKEN" } })).toBe(1);
    expect(await prisma.rideEvent.count({ where: { rideId: ride.id, type: "swap.taken" } })).toBe(1);
    // Déjà reprise : un second collègue échoue
    const late = await mkDriver();
    expect((await call(`/driver/swaps/${ride.id}/take`, { token: late.token, body: {} })).status).toBe(409);
  });

  it("refusé à moins de 48 h, et invisible pour un véhicule non équipé", async () => {
    const soon = await assigned(1);
    const r = await call(`/driver/rides/${soon.ride.id}/swap`, { token: soon.owner.token, body: {} });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/sauveteur/);
    const { owner, ride } = await assigned(3, ["CHILD_SEAT"]);
    expect((await call(`/driver/rides/${ride.id}/swap`, { token: owner.token, body: {} })).status).toBe(201);
    const plain = await mkDriver();
    expect((await call("/driver/swaps", { token: plain.token })).json).toEqual([]);
    expect((await call(`/driver/swaps/${ride.id}/take`, { token: plain.token, body: {} })).status).toBe(409);
    const seat = await mkDriver(["CHILD_SEAT"]);
    expect((await call("/driver/swaps", { token: seat.token })).json).toHaveLength(1);
  });

  it("le chauffeur peut retirer sa mission de la bourse", async () => {
    const { owner, ride } = await assigned();
    await call(`/driver/rides/${ride.id}/swap`, { token: owner.token, body: {} });
    expect((await call(`/driver/rides/${ride.id}/swap`, { token: owner.token, method: "DELETE" })).status).toBe(200);
    const mate = await mkDriver();
    expect((await call("/driver/swaps", { token: mate.token })).json).toEqual([]);
    expect((await call(`/driver/swaps/${ride.id}/take`, { token: mate.token, body: {} })).status).toBe(409);
  });
});
