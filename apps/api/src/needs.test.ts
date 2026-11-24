import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { hasNeeds } from "./vehicle-rules";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;

async function call(path: string, opts: { token?: string; admin?: boolean; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(base + path, {
    method: opts.body !== undefined ? "POST" : "GET",
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
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `B${n}`, lastName: "Test", phone: `+3360003${String(n).padStart(4, "0")}`, email: `b${n}@test.fr`, vehicle: { plate: `NB-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE", ...(features ? { features } : {}) } } });
  expect(r.status).toBe(201);
  const id: string = r.json.id;
  await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: `k/${type}`, status: "APPROVED" as const })) });
  await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} });
  const token: string = (await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } })).json.token;
  await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
  await call("/driver/location", { token, body: { lat: 48.86, lng: 2.35 } });
  return { id, token };
}
async function book(p: { apiKey: string }, needs?: unknown) {
  const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: new Date(Date.now() + 3 * 86400_000).toISOString(), category: "BERLINE", passengers: 3, luggage: 2 } });
  return call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": `k-${Math.random()}` }, body: { quoteId: q.json.quoteId, externalReference: "BK", ...(needs !== undefined ? { needs } : {}), passenger: { firstName: "Mia", lastName: "Jensen", phone: "+4520123456", language: "en" } } });
}

describe("équipements du véhicule", () => {
  it("exige tous les équipements demandés", () => {
    expect(hasNeeds({ features: ["CHILD_SEAT", "PET"] }, ["CHILD_SEAT"])).toBe(true);
    expect(hasNeeds({ features: ["CHILD_SEAT"] }, ["CHILD_SEAT", "PET"])).toBe(false);
    expect(hasNeeds({ features: [] }, [])).toBe(true);
    expect(hasNeeds({}, ["WHEELCHAIR"])).toBe(false);
  });
});

describe("besoins particuliers", () => {
  it("ne propose la mission qu'aux véhicules équipés, et refuse l'attribution à un véhicule non équipé", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const equipped = await mkDriver(["CHILD_SEAT", "BOOSTER"]);
    const plain = await mkDriver();
    const b = await book(p, ["CHILD_SEAT"]);
    expect(b.status).toBe(201);
    expect(b.json.needs).toEqual(["CHILD_SEAT"]); // visible du partenaire
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
    expect(await prisma.dispatchOffer.count({ where: { rideId: ride.id, driverId: equipped.id } })).toBe(1);
    expect(await prisma.dispatchOffer.count({ where: { rideId: ride.id, driverId: plain.id } })).toBe(0);
    const offers = (await call("/driver/offers", { token: equipped.token })).json;
    expect(offers[0].needs).toEqual(["CHILD_SEAT"]); // le chauffeur le voit avant d'accepter
    const bad = await call(`/admin/rides/${ride.id}/assign`, { admin: true, body: { driverId: plain.id } });
    expect(bad.status).toBe(409);
    expect(bad.json.message).toMatch(/équipé/);
    expect((await call(`/admin/rides/${ride.id}/assign`, { admin: true, body: { driverId: equipped.id } })).status).toBe(201);
    const view = (await call(`/driver/rides/${ride.id}`, { token: equipped.token })).json;
    expect(view.needs).toEqual(["CHILD_SEAT"]);
  });

  it("sans besoin particulier, tous les véhicules conviennent ; un besoin inconnu est refusé", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const plain = await mkDriver();
    const b = await book(p);
    expect(b.json.needs).toEqual([]);
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
    expect(await prisma.dispatchOffer.count({ where: { rideId: ride.id, driverId: plain.id } })).toBe(1);
    expect((await book(p, ["HELICOPTER"])).status).toBe(422);
    // un équipement inconnu sur un véhicule est refusé aussi
    const r = await call("/admin/drivers", { admin: true, body: { firstName: "X", lastName: "Y", phone: "+33600039999", email: "xy@test.fr", vehicle: { plate: "ZZ-999-ZZ", make: "A", model: "B", category: "BERLINE", features: ["JACUZZI"] } } });
    expect(r.status).toBe(422);
  });
});
