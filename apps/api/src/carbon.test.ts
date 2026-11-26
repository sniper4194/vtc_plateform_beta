import { manualAssignment } from "../test/manual-assignment";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { carbonFactors, rideCarbon } from "./carbon";

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
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `B${n}`, lastName: "Test", phone: `+3360006${String(n).padStart(4, "0")}`, email: `b${n}@test.fr`, vehicle: { plate: `CB-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE", ...(features ? { features } : {}) } } });
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

const F = { CARBON_FACTOR_THERMAL: "0.2", CARBON_FACTOR_HYBRID: "0.15", CARBON_FACTOR_ELECTRIC: "0.1", CARBON_SOURCE: "Valeurs de TEST, pas des facteurs ADEME" };

describe("facteurs d'émission", () => {
  it("aucun facteur par défaut : tout ou rien, avec une source", () => {
    expect(carbonFactors({})).toBeNull();
    expect(carbonFactors({ ...F, CARBON_SOURCE: "" })).toBeNull();
    expect(carbonFactors({ ...F, CARBON_FACTOR_HYBRID: "" })).toBeNull();
    expect(carbonFactors({ ...F, CARBON_FACTOR_THERMAL: "218" })).toBeNull(); // g au lieu de kg : refusé
    expect(carbonFactors(F)).toMatchObject({ THERMAL: 0.2, ELECTRIC: 0.1 });
  });
  it("seulement les courses terminées dont la motorisation est connue", () => {
    const f = carbonFactors(F);
    expect(rideCarbon({ status: "COMPLETED", distanceKm: 30 }, "THERMAL", f)?.kgCO2e).toBe(6);
    expect(rideCarbon({ status: "COMPLETED", distanceKm: 30 }, "ELECTRIC", f)?.kgCO2e).toBe(3);
    expect(rideCarbon({ status: "ASSIGNED", distanceKm: 30 }, "THERMAL", f)).toBeNull();
    expect(rideCarbon({ status: "COMPLETED", distanceKm: 30 }, null, f)).toBeNull();
    expect(rideCarbon({ status: "COMPLETED", distanceKm: 30 }, "THERMAL", null)).toBeNull();
  });
});

describe("bilan carbone partenaire", () => {
  const saved = { ...process.env };
  afterEach(() => { for (const k of Object.keys(F)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("désactivé sans facteurs, puis calculé par course et sur la période", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const other = (await call("/admin/partners", { admin: true, body: { name: "Q" } })).json;
    const d = await mkDriver();
    await prisma.vehicle.updateMany({ where: { driverId: d.id }, data: { fuel: "ELECTRIC" } });
    const b = await book(p);
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
    await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, d.id));
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "COMPLETED", pickupAt: new Date(Date.now() - 86400_000) } });
    await book(other); // une course d'un autre partenaire ne doit pas apparaître

    expect((await call("/v1/carbon", { token: p.apiKey })).json).toMatchObject({ enabled: false });
    expect((await call(`/v1/bookings/${b.json.id}`, { token: p.apiKey })).json.carbon).toBeNull();

    Object.assign(process.env, F);
    const view = (await call(`/v1/bookings/${b.json.id}`, { token: p.apiKey })).json;
    expect(view.carbon).toMatchObject({ fuel: "ELECTRIC", factorKgPerKm: 0.1, source: F.CARBON_SOURCE });
    expect(view.carbon.kgCO2e).toBeCloseTo(Math.round(ride.distanceKm * 0.1 * 10) / 10, 5);
    const sum = (await call("/v1/carbon", { token: p.apiKey })).json;
    expect(sum).toMatchObject({ enabled: true, rides: 1, unknownFuelRides: 0 });
    expect(sum.byFuel.ELECTRIC.rides).toBe(1);
    expect(sum.lines[0].reference).toBe(`R-${ride.ref}`);
    expect((await call("/admin/carbon", { admin: true })).json.rides).toBe(1);
  });
});
