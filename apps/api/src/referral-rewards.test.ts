import { manualAssignment } from "../test/manual-assignment";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { referralRewardConfig, rewardCents } from "./referral-rewards";
import { aggregate, earningsCsv } from "./earnings";

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
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `B${n}`, lastName: "Test", phone: `+3360007${String(n).padStart(4, "0")}`, email: `b${n}@test.fr`, vehicle: { plate: `RR-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE", ...(features ? { features } : {}) } } });
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

const ON = { REFERRAL_REWARD_ENABLED: "1", REFERRAL_REWARD_CENTS: "150", REFERRAL_REWARD_RIDES: "2" };

describe("règle de la prime", () => {
  it("désactivée par défaut, plafonnée en nombre de courses et par la commission", () => {
    expect(referralRewardConfig({}).enabled).toBe(false);
    expect(rewardCents(1, 1000, referralRewardConfig({}))).toBe(0);
    const cfg = referralRewardConfig(ON);
    expect(rewardCents(1, 1000, cfg)).toBe(150);
    expect(rewardCents(2, 1000, cfg)).toBe(150);
    expect(rewardCents(3, 1000, cfg)).toBe(0);
    expect(rewardCents(1, 80, cfg)).toBe(80); // jamais plus que la commission restante
  });
  it("apparaît dans les revenus et l'export du parrain", () => {
    const e = aggregate([], [], [], [{ id: "x", at: new Date("2026-06-01T10:00:00Z"), cents: 150, filleul: "Lena K." }]);
    expect(e.totals).toMatchObject({ referralCents: 150, netCents: 150 });
    expect(earningsCsv(e)).toContain("PRIME_PARRAINAGE;2026-06-01;;\"Course de votre filleul Lena K.\";1,50");
  });
});

describe("parrainage récompensé (parcours)", () => {
  const saved = { ...process.env };
  afterEach(() => { for (const k of Object.keys(ON)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  async function completedRide(p: { apiKey: string }, d: { id: string; token: string }) {
    const b = await book(p);
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
    await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, d.id));
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "IN_PROGRESS" } });
    expect((await call(`/driver/rides/${ride.id}/complete`, { token: d.token, body: {} })).status).toBe(201);
    return prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
  }

  it("un seul niveau, sur les N premières courses, pris sur la commission ; rien si désactivé", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const grand = await mkDriver(), sponsor = await mkDriver(), filleul = await mkDriver();
    await prisma.driver.update({ where: { id: sponsor.id }, data: { sponsorId: grand.id } });
    await prisma.driver.update({ where: { id: filleul.id }, data: { sponsorId: sponsor.id } });

    const off = await completedRide(p, filleul); // désactivé : rien
    expect(await prisma.referralReward.count()).toBe(0);
    expect((await call("/driver/referral", { token: sponsor.token })).json.reward).toBeNull();

    Object.assign(process.env, ON);
    const before = await prisma.ride.findUniqueOrThrow({ where: { id: off.id } });
    const r2 = await completedRide(p, filleul); // 2e course terminée : dans la limite de 2
    expect(await prisma.referralReward.count({ where: { sponsorId: sponsor.id } })).toBe(1);
    await completedRide(p, filleul); // 3e : au-delà
    expect(await prisma.referralReward.count()).toBe(1);
    expect(await prisma.referralReward.count({ where: { sponsorId: grand.id } })).toBe(0); // pas de second niveau
    // Pris sur la commission, net du filleul inchangé
    expect(r2.driverNetCents).toBe(before.driverNetCents);
    expect(r2.commissionCents).toBe(before.commissionCents - 150);
    const info = (await call("/driver/referral", { token: sponsor.token })).json;
    expect(info.reward).toEqual({ amountCents: 150, rides: 2, earnedCents: 150 });
    const earn = (await call("/driver/earnings?period=month", { token: sponsor.token })).json;
    expect(earn.totals.referralCents).toBe(150);
  });
});
