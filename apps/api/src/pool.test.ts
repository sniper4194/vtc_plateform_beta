import { manualAssignment } from "../test/manual-assignment";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { poolShareCents } from "./pool";

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
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `B${n}`, lastName: "Test", phone: `+3360008${String(n).padStart(4, "0")}`, email: `b${n}@test.fr`, vehicle: { plate: `PO-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE", ...(features ? { features } : {}) } } });
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

describe("part reversée", () => {
  it("calculée sur le net de base, 0 % par défaut", () => {
    expect(poolShareCents(3000, 0)).toBe(0);
    expect(poolShareCents(3000, 10)).toBe(300);
  });
});

describe("mise en commun entre sociétés", () => {
  const saved = process.env.POOL_SHARE_PERCENT;
  afterEach(() => { if (saved === undefined) delete process.env.POOL_SHARE_PERCENT; else process.env.POOL_SHARE_PERCENT = saved; });
  let k = 0;
  async function mkCompany(name: string) {
    const r = await call("/admin/companies", { admin: true, body: { name } });
    return { id: r.json.companyId as string, key: r.json.accessKey as string };
  }
  async function companyDriver(co: { id: string }, features?: string[]) {
    const d = await mkDriver(features);
    await prisma.driver.update({ where: { id: d.id }, data: { companyId: co.id } });
    return d;
  }

  it("une société confie, une autre la prend avec un chauffeur éligible ; part annoncée et reversée", async () => {
    process.env.POOL_SHARE_PERCENT = "10";
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const a = await mkCompany(`A${++k}`), b = await mkCompany(`B${k}`);
    const da = await companyDriver(a), db = await companyDriver(b);
    const bk = await book(p, undefined, 3);
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: bk.json.id } });
    await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, da.id));
    const before = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });

    // Réciproque : il faut s'inscrire pour confier
    expect((await call("/company/pool", { token: a.key, body: { rideId: ride.id } })).status).toBe(409);
    await call("/company/pool/opt-in", { token: a.key, body: { enabled: true } });
    const g = await call("/company/pool", { token: a.key, body: { rideId: ride.id } });
    expect(g.status).toBe(201);
    expect(g.json.sharePercent).toBe(10);
    // B ne voit rien tant qu'elle ne s'est pas inscrite
    expect((await call("/company/pool", { token: b.key })).json.available).toEqual([]);
    await call("/company/pool/opt-in", { token: b.key, body: { enabled: true } });
    const board = (await call("/company/pool", { token: b.key })).json;
    expect(board.available).toHaveLength(1);
    const base = before.driverNetCents - before.ecoBonusCents;
    expect(board.available[0].shareCents).toBe(Math.round(base * 0.1));
    expect(board.available[0].drivers.map((d: any) => d.id)).toEqual([db.id]);
    // A ne peut pas prendre sa propre mission ; B ne peut pas utiliser un chauffeur d'une autre société
    expect((await call(`/company/pool/${g.json.id}/take`, { token: a.key, body: { driverId: da.id } })).status).toBe(409);
    expect((await call(`/company/pool/${g.json.id}/take`, { token: b.key, body: { driverId: da.id } })).status).toBe(404);
    const t = await call(`/company/pool/${g.json.id}/take`, { token: b.key, body: { driverId: db.id } });
    expect(t.status).toBe(201);
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.driverId).toBe(db.id);
    expect(after.driverNetCents).toBe(base - Math.round(base * 0.1) + after.ecoBonusCents);
    expect(after.commissionCents).toBe(before.commissionCents + before.ecoBonusCents - after.ecoBonusCents); // la commission CliCab ne bouge pas
    expect(await prisma.notification.count({ where: { driverId: da.id, type: "POOL_TAKEN" } })).toBe(1);
    expect(await prisma.driverPenalty.count({ where: { driverId: da.id } })).toBe(0);
    // Course réalisée : la part apparaît au relevé de A
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "COMPLETED", pickupAt: new Date(Date.now() - 3600_000) } });
    const st = (await call("/company/payments", { token: a.key })).json;
    const row = st.rows.find((r: any) => r.kind === "MISE_EN_COMMUN");
    expect(row.netCents).toBe(Math.round(base * 0.1));
  });

  it("refusé à moins de 24 h, et une société qui se retire annule ses propositions", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const a = await mkCompany(`A${++k}`);
    const da = await companyDriver(a);
    await call("/company/pool/opt-in", { token: a.key, body: { enabled: true } });
    const soon = await book(p, undefined, 0.5);
    const r1 = await prisma.ride.findFirstOrThrow({ where: { bookingId: soon.json.id } });
    await call(`/admin/rides/${r1.id}/assign`, await manualAssignment(prisma, r1.id, da.id));
    expect((await call("/company/pool", { token: a.key, body: { rideId: r1.id } })).status).toBe(409);
    const later = await book(p, undefined, 3);
    const r2 = await prisma.ride.findFirstOrThrow({ where: { bookingId: later.json.id } });
    await call(`/admin/rides/${r2.id}/assign`, await manualAssignment(prisma, r2.id, da.id));
    expect((await call("/company/pool", { token: a.key, body: { rideId: r2.id } })).status).toBe(201);
    await call("/company/pool/opt-in", { token: a.key, body: { enabled: false } });
    expect(await prisma.ridePool.count({ where: { status: "OPEN" } })).toBe(0);
  });
});
