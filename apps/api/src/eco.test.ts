import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { ecoBonusCents } from "./eco";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;

async function call(path: string, opts: { method?: string; token?: string; admin?: boolean; body?: unknown; headers?: Record<string, string> } = {}) {
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
  await prisma.$executeRawUnsafe('TRUNCATE "Incident","IdentityCheck","DriverPenalty","RescueRequest","Notification","OtpCode","AdminUser","WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE');
});
afterEach(() => { delete process.env.ECO_BONUS_PERCENT; });

const CDG = { address: "Aéroport CDG T2", lat: 49.0097, lng: 2.5479 };
const PARIS = { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 };
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

async function mkPartner() {
  const r = await call("/admin/partners", { admin: true, body: { name: "Partenaire (test)" } });
  return r.json as { apiKey: string };
}
let n = 0;
async function mkDriver(fuel: "ELECTRIC" | "THERMAL" | "HYBRID", category = "BERLINE") {
  n++;
  const r = await call("/admin/drivers", {
    admin: true,
    body: { firstName: `Chauffeur${n}`, lastName: "Test", phone: `+3360000${String(n).padStart(4, "0")}`, email: `e${n}@test.fr`, vehicle: { plate: `EE-${String(n).padStart(3, "0")}-ZZ`, make: "Tesla", model: "Model 3", category, fuel } },
  });
  const id: string = r.json.id;
  await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: `k/${type}`, status: "APPROVED" as const })) });
  expect((await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} })).status).toBe(201);
  const token: string = (await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } })).json.token;
  await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
  await call("/driver/location", { token, body: { lat: 48.86, lng: 2.35 } });
  return { id, token };
}
async function book(p: { apiKey: string }, category: string) {
  const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category, passengers: 2, luggage: 1 } });
  expect(q.status).toBe(201);
  const b = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": `k-${Math.random()}` }, body: { quoteId: q.json.quoteId, externalReference: "BK", passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000", language: "pt" } } });
  expect(b.status).toBe(201);
}
async function accept(d: { token: string }) {
  const offers = await call("/driver/offers", { token: d.token });
  expect(offers.json).toHaveLength(1);
  const offer = offers.json[0];
  expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);
  return offer;
}

describe("prime écologique : calcul", () => {
  it("5 % de la rémunération, seulement pour un véhicule électrique, plafonnée par la commission restante", () => {
    expect(ecoBonusCents("ELECTRIC", 10000, 2000, {} as any)).toBe(500); // 5 % de 100 €
    expect(ecoBonusCents("ELECTRIC", 4400, 2000, {} as any)).toBe(220);
    expect(ecoBonusCents("ELECTRIC", 10000, 120, {} as any)).toBe(120); // jamais plus que la commission restante
    expect(ecoBonusCents("ELECTRIC", 10000, -50, {} as any)).toBe(0); // commission déjà négative : pas de prime
    expect(ecoBonusCents("HYBRID", 10000, 2000, {} as any)).toBe(0);
    expect(ecoBonusCents("THERMAL", 10000, 2000, {} as any)).toBe(0);
    expect(ecoBonusCents(null, 10000, 2000, {} as any)).toBe(0);
    expect(ecoBonusCents("ELECTRIC", 10000, 2000, { ECO_BONUS_PERCENT: "8" } as any)).toBe(800);
    expect(ecoBonusCents("ELECTRIC", 10000, 2000, { ECO_BONUS_PERCENT: "0" } as any)).toBe(0); // désactivée
  });
});

describe("prime écologique : parcours", () => {
  it("annoncée avant l'acceptation, versée au chauffeur, prélevée sur la commission", async () => {
    const p = await mkPartner();
    const d = await mkDriver("ELECTRIC");
    await book(p, "BERLINE");
    const offer = await accept(d);
    const ride = await prisma.ride.findFirstOrThrow({ where: { driverId: d.id } });
    expect(offer.ecoBonusCents).toBeGreaterThan(0);
    expect(ride.ecoBonusCents).toBe(offer.ecoBonusCents);
    expect(ride.ecoBonusCents).toBe(Math.round(((ride.driverNetCents - ride.ecoBonusCents) * 5) / 100)); // 5 % du prix proposé
    // le prix client ne bouge pas : net + commission = prix client
    expect(ride.driverNetCents + ride.commissionCents).toBe(ride.priceCents);
    expect(ride.driverNetCents).toBe(offer.netCents); // le prix annoncé est celui qui est payé
    const msg = await prisma.notification.findFirstOrThrow({ where: { driverId: d.id, type: "RIDE_ACCEPTED" } });
    expect(msg.body).toContain("prime écologique");
  });

  it("aucune prime pour un véhicule thermique ou hybride, à prix égal", async () => {
    const p = await mkPartner();
    const thermal = await mkDriver("THERMAL");
    await book(p, "BERLINE");
    const o = await accept(thermal);
    expect(o.ecoBonusCents).toBe(0);
    const t = await prisma.ride.findFirstOrThrow({ where: { driverId: thermal.id } });
    expect(t.ecoBonusCents).toBe(0);
    expect(t.driverNetCents).toBe(o.netCents);
  });

  it("l'électrique touche exactement la prime de plus qu'un thermique", async () => {
    const p = await mkPartner();
    const [e, t] = [await mkDriver("ELECTRIC"), await mkDriver("THERMAL")];
    await book(p, "BERLINE");
    const oe = await accept(e);
    await book(p, "BERLINE"); // le chauffeur électrique est déjà pris sur ce créneau : seule la voiture thermique reçoit l'offre
    const ot = await accept(t);
    expect(oe.ecoBonusCents).toBeGreaterThan(0);
    expect(oe.netCents - ot.netCents).toBe(oe.ecoBonusCents); // même mission, même prix de base : l'écart est exactement la prime
  });

  it("la prime est plafonnée par la commission restante", async () => {
    process.env.ECO_BONUS_PERCENT = "100"; // énorme : seule la commission restante limite
    const p = await mkPartner();
    const d = await mkDriver("ELECTRIC");
    await book(p, "BERLINE");
    const offer = await accept(d);
    const ride = await prisma.ride.findFirstOrThrow({ where: { driverId: d.id } });
    expect(ride.commissionCents).toBeGreaterThanOrEqual(0); // la plateforme ne vend jamais à perte à cause de la prime
    expect(ride.driverNetCents).toBe(offer.netCents);
    expect(ride.driverNetCents).toBeLessThanOrEqual(ride.priceCents);
  });

  it("désactivée : aucune prime", async () => {
    process.env.ECO_BONUS_PERCENT = "0";
    const p = await mkPartner();
    const d = await mkDriver("ELECTRIC");
    await book(p, "BERLINE");
    expect((await accept(d)).ecoBonusCents).toBe(0);
  });
});

describe("vans : prix client et part du chauffeur", () => {
  it("un van coûte plus cher qu'une berline, et son chauffeur touche une part plus grande du prix", async () => {
    const p = await mkPartner();
    const vanDriver = await mkDriver("THERMAL", "VAN");
    const berlineDriver = await mkDriver("THERMAL", "BERLINE");
    await book(p, "VAN");
    await accept(vanDriver);
    await book(p, "BERLINE");
    await accept(berlineDriver);
    const van = await prisma.ride.findFirstOrThrow({ where: { driverId: vanDriver.id } });
    const berline = await prisma.ride.findFirstOrThrow({ where: { driverId: berlineDriver.id } });
    expect(van.priceCents).toBeGreaterThan(berline.priceCents); // forfait CDG-Paris : 95 € contre 55 €
    expect(van.driverCapCents / van.priceCents).toBeGreaterThan(berline.driverCapCents / berline.priceCents); // commission de 15 % contre 20 %
    expect(van.driverCapCents / van.priceCents).toBeCloseTo(0.85, 2);
    expect(berline.driverCapCents / berline.priceCents).toBeCloseTo(0.8, 2);
  });
});
