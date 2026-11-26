import { manualAssignment } from "../test/manual-assignment";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";

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
  await prisma.$executeRawUnsafe('TRUNCATE "RideProof","Incident","IdentityCheck","DriverPenalty","RescueRequest","Notification","OtpCode","WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE');
});
afterEach(() => { delete process.env.FATIGUE_MAX_MISSION_HOURS; });

const CDG = { address: "Aéroport CDG T2", lat: 49.0097, lng: 2.5479 };
const PARIS = { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 };
const DAY0 = Date.now() + 3 * 86400_000;
const at = (h: number) => new Date(DAY0 + h * 3600_000).toISOString();

let n = 0;
async function mkDriver(lat = 48.86, lng = 2.35) {
  n++;
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `C${n}`, lastName: "Test", phone: `+3360001${String(n).padStart(4, "0")}`, email: `f${n}@test.fr`, vehicle: { plate: `FF-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE" } } });
  const id: string = r.json.id;
  await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: `k/${type}`, status: "APPROVED" as const })) });
  expect((await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} })).status).toBe(201);
  const token: string = (await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } })).json.token;
  await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
  await call("/driver/location", { token, body: { lat, lng } });
  return { id, token };
}
async function book(p: { apiKey: string }, pickup: typeof CDG, dropoff: typeof CDG, pickupAt: string) {
  const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup, dropoff, pickupAt, category: "BERLINE", passengers: 1, luggage: 1 } });
  expect(q.status).toBe(201);
  const b = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": `k-${Math.random()}` }, body: { quoteId: q.json.quoteId, externalReference: "BK", passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000", language: "pt" } } });
  expect(b.status).toBe(201);
  return prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
}
const offersOf = (driverId: string, rideId: string) => prisma.dispatchOffer.count({ where: { driverId, rideId } });

describe("garde-fou fatigue", () => {
  async function tiredDriver(p: { apiKey: string }) {
    const tired = await mkDriver();
    const a = await book(p, PARIS, CDG, at(0));
    // la mission est attribuée puis « allongée » à 9 h : le chauffeur a une très longue journée
    await call(`/admin/rides/${a.id}/assign`, await manualAssignment(prisma, a.id, tired.id));
    await prisma.ride.update({ where: { id: a.id }, data: { durationMin: 9 * 60 } });
    return tired;
  }

  it("ne propose plus d'offre au-delà du maximum sur 24 h, et refuse l'attribution avec une explication", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const tired = await tiredDriver(p);
    const fresh = await mkDriver();
    const b = await book(p, CDG, PARIS, at(11)); // 9 h + marge + ce trajet > 10 h
    expect(await offersOf(tired.id, b.id)).toBe(0);
    expect(await offersOf(fresh.id, b.id)).toBe(1);
    const ev = await prisma.rideEvent.findFirstOrThrow({ where: { rideId: b.id, type: "dispatch.round" } });
    expect((ev.payload as any).rested).toBe(1);
    const assign = await call(`/admin/rides/${b.id}/assign`, await manualAssignment(prisma, b.id, tired.id));
    expect(assign.status).toBe(409);
    expect(assign.json.message).toMatch(/Repos nécessaire/);
    // son écran d'accueil le lui montre
    const home = await call("/driver/home", { token: tired.token });
    expect(home.json.fatigue).toMatchObject({ maxMinutes: 600 });
  });

  it("désactivable (0) : l'offre est de nouveau proposée", async () => {
    process.env.FATIGUE_MAX_MISSION_HOURS = "0";
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const tired = await tiredDriver(p);
    const b = await book(p, CDG, PARIS, at(11));
    expect(await offersOf(tired.id, b.id)).toBe(1);
  });
});

describe("missions de retour", () => {
  it("repère l'offre qui part près de l'arrivée d'une mission prévue, et la met en tête", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const d1 = await mkDriver(), d2 = await mkDriver(49.0, 2.54);
    const a = await book(p, PARIS, CDG, at(0)); // Paris → Roissy
    await call(`/admin/rides/${a.id}/assign`, await manualAssignment(prisma, a.id, d1.id));
    const end = new Date(at(0)).getTime() + a.durationMin * 60_000;
    const later = await book(p, PARIS, CDG, at(8)); // sans rapport : plus tard, ailleurs
    const back = await book(p, { address: "CDG T2 arrivées", lat: 49.008, lng: 2.55 }, PARIS, new Date(end + 45 * 60_000).toISOString());
    void later;

    const o1 = (await call("/driver/offers", { token: d1.token })).json;
    expect(o1[0].returnTrip).toMatchObject({ afterRef: a.ref, gapMin: 45 });
    expect(o1[0].pickup).toBe("CDG T2 arrivées"); // en tête, même si une autre offre existe
    expect(o1.filter((o: any) => o.returnTrip)).toHaveLength(1);
    // pour un autre chauffeur, ce n'est pas un retour
    const o2 = (await call("/driver/offers", { token: d2.token })).json;
    expect(o2.every((o: any) => o.returnTrip === null)).toBe(true);
    const ev = await prisma.rideEvent.findFirstOrThrow({ where: { rideId: back.id, type: "dispatch.round" } });
    expect((ev.payload as any).returnTrips).toBe(1);
  });
});
