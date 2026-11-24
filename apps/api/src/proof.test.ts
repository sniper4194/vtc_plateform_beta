import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { imageMime, proofFlags, proofLimits } from "./proof";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;

async function call(path: string, opts: { method?: string; token?: string; admin?: boolean; body?: unknown; headers?: Record<string, string>; raw?: boolean } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.admin ? { "x-admin-token": "test-admin-token-test-admin-token" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") };
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
  await prisma.$executeRawUnsafe('TRUNCATE "RideProof","Incident","IdentityCheck","DriverPenalty","RescueRequest","Notification","OtpCode","AdminUser","WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE');
});
afterEach(() => { for (const k of ["PROOF_MAX_BYTES", "PROOF_MAX_PER_RIDE"]) delete process.env[k]; });

const CDG = { address: "Aéroport CDG T2", lat: 49.0097, lng: 2.5479 };
const PARIS = { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 };
const jpeg = (fill = 7, size = 400) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, fill)]);
const b64 = (b: Buffer) => b.toString("base64");

async function mkPartner(name = "Partenaire (test)") { return (await call("/admin/partners", { admin: true, body: { name } })).json as { apiKey: string }; }
let n = 0;
async function mkDriver() {
  n++;
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `Chauffeur${n}`, lastName: "Test", phone: `+3360000${String(n).padStart(4, "0")}`, email: `p${n}@test.fr`, vehicle: { plate: `PP-${String(n).padStart(3, "0")}-ZZ`, make: "Toyota", model: "Camry", category: "BERLINE" } } });
  const id: string = r.json.id;
  await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: `k/${type}`, status: "APPROVED" as const })) });
  expect((await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} })).status).toBe(201);
  const token: string = (await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } })).json.token;
  await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
  await call("/driver/location", { token, body: { lat: 49.0, lng: 2.5 } });
  return { id, token };
}
/** Une mission acceptée ; `upTo` : jusqu'où la faire avancer. */
async function mission(p: { apiKey: string }, d: { id: string; token: string }, upTo: "ASSIGNED" | "ARRIVED" | "IN_PROGRESS" = "ARRIVED") {
  const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: new Date(Date.now() + 3 * 86400_000).toISOString(), category: "BERLINE", passengers: 2, luggage: 1 } });
  const b = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": `k-${Math.random()}` }, body: { quoteId: q.json.quoteId, externalReference: "BK", passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000", language: "fr" } } });
  const offers = await call("/driver/offers", { token: d.token });
  expect((await call(`/driver/offers/${offers.json[0].offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);
  const ride = await prisma.ride.findFirstOrThrow({ where: { driverId: d.id }, orderBy: { createdAt: "desc" } });
  const steps = upTo === "ASSIGNED" ? [] : upTo === "ARRIVED" ? ["en-route", "arrived"] : ["en-route", "arrived", "start"];
  for (const s of steps) expect((await call(`/driver/rides/${ride.id}/${s}`, { token: d.token, body: {} })).status).toBe(201);
  return { rideId: ride.id, bookingId: b.json.id as string };
}
const proof = (over: Record<string, unknown> = {}) => ({ kind: "NO_SHOW", image: b64(jpeg()), lat: CDG.lat, lng: CDG.lng, accuracyM: 8, address: "Terminal 2, Roissy-en-France", capturedAt: new Date().toISOString(), ...over });

describe("règles pures", () => {
  it("reconnaît JPEG et PNG, rien d'autre", () => {
    expect(imageMime(jpeg())).toBe("image/jpeg");
    expect(imageMime(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]))).toBe("image/png");
    expect(imageMime(Buffer.from("pas une image du tout"))).toBeNull();
  });
  it("signale sans refuser : loin, imprécis, heure du téléphone décalée ou absente", () => {
    const now = new Date();
    const lim = proofLimits({} as any);
    expect(proofFlags({ distanceM: 40, accuracyM: 10, deviceTakenAt: now, receivedAt: now }, lim)).toEqual([]);
    expect(proofFlags({ distanceM: 2000, accuracyM: 10, deviceTakenAt: now, receivedAt: now }, lim)).toEqual(["FAR_FROM_PICKUP"]);
    expect(proofFlags({ distanceM: 40, accuracyM: 500, deviceTakenAt: now, receivedAt: now }, lim)).toEqual(["LOW_ACCURACY"]);
    expect(proofFlags({ distanceM: 40, accuracyM: 10, deviceTakenAt: new Date(now.getTime() - 3600_000), receivedAt: now }, lim)).toEqual(["CLOCK_MISMATCH"]);
    expect(proofFlags({ distanceM: 40, accuracyM: 10, deviceTakenAt: null, receivedAt: now }, lim)).toEqual(["NO_DEVICE_TIME"]);
  });
});

describe("photo-preuve du chauffeur", () => {
  it("enregistre la photo avec l'heure du serveur, la position et la distance au lieu de prise en charge", async () => {
    const p = await mkPartner(), d = await mkDriver();
    const { rideId } = await mission(p, d);
    const img = jpeg(9, 800);
    const before = Date.now();
    const r = await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ image: b64(img), kind: "EXCESS_LUGGAGE", note: "5 valises pour 2 passagers" }) });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ kind: "EXCESS_LUGGAGE", label: "Bagages en excès", note: "5 valises pour 2 passagers", flags: [] });
    expect(r.json.distanceToPickupM).toBeLessThan(10);
    expect(new Date(r.json.receivedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(r.json.sha256).toBe(createHash("sha256").update(img).digest("hex"));
    expect(r.json.location).toMatchObject({ lat: CDG.lat, lng: CDG.lng, accuracyM: 8, address: "Terminal 2, Roissy-en-France" });
    // la photo est restituée à l'identique
    const photo = await call(r.json.photo, { token: d.token, raw: true });
    expect(photo.status).toBe(200);
    expect(photo.type).toBe("image/jpeg");
    expect(photo.bytes.equals(img)).toBe(true);
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token })).json).toHaveLength(1);
    expect(await prisma.rideEvent.count({ where: { rideId, type: "driver.proof" } })).toBe(1);
  });

  it("signale une position éloignée, imprécise ou une heure décalée, sans refuser la photo", async () => {
    const p = await mkPartner(), d = await mkDriver();
    const { rideId } = await mission(p, d);
    const r = await call(`/driver/rides/${rideId}/proofs`, {
      token: d.token, body: proof({ lat: PARIS.lat, lng: PARIS.lng, accuracyM: 900, capturedAt: new Date(Date.now() - 3600_000).toISOString() }),
    });
    expect(r.status).toBe(201);
    expect(r.json.flags.map((f: any) => f.code).sort()).toEqual(["CLOCK_MISMATCH", "FAR_FROM_PICKUP", "LOW_ACCURACY"]);
    expect(r.json.distanceToPickupM).toBeGreaterThan(20_000);
    const noClock = await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ capturedAt: undefined }) });
    expect(noClock.json.flags.map((f: any) => f.code)).toEqual(["NO_DEVICE_TIME"]);
  });

  it("refuse avant l'arrivée, la mission d'un autre chauffeur, un fichier invalide, trop lourd, et au-delà de la limite", async () => {
    const p = await mkPartner(), d = await mkDriver();
    const { rideId } = await mission(p, d, "ASSIGNED");
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof() })).status).toBe(409); // pas encore sur place
    await call(`/driver/rides/${rideId}/en-route`, { token: d.token, body: {} });
    await call(`/driver/rides/${rideId}/arrived`, { token: d.token, body: {} });

    const other = await mkDriver();
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: other.token, body: proof() })).status).toBe(404);
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: other.token })).status).toBe(404);

    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ image: b64(Buffer.from("x".repeat(300))) }) })).status).toBe(422);
    process.env.PROOF_MAX_BYTES = "500";
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ image: b64(jpeg(1, 900)) }) })).status).toBe(413);
    delete process.env.PROOF_MAX_BYTES;
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ lat: 95 }) })).status).toBe(422);
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ kind: "AUTRE" }) })).status).toBe(422);

    process.env.PROOF_MAX_PER_RIDE = "2";
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof() })).status).toBe(201);
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof() })).status).toBe(201);
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof() })).status).toBe(429);
  });

  it("est possible pendant la course (bagages) et exige d'être connecté", async () => {
    const p = await mkPartner(), d = await mkDriver();
    const { rideId } = await mission(p, d, "IN_PROGRESS");
    expect((await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ kind: "EXCESS_LUGGAGE" }) })).status).toBe(201);
    expect((await call(`/driver/rides/${rideId}/proofs`, { body: proof() })).status).toBe(401);
  });
});

describe("consultation par le partenaire et l'équipe", () => {
  it("le partenaire voit les preuves de sa réservation (jamais celles d'un autre), avec la photo", async () => {
    const p = await mkPartner("Partenaire A"), other = await mkPartner("Partenaire B"), d = await mkDriver();
    const { rideId, bookingId } = await mission(p, d);
    const img = jpeg(3, 600);
    const made = (await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ image: b64(img) }) })).json;

    const list = await call(`/v1/bookings/${bookingId}/proofs`, { token: p.apiKey });
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(1);
    expect(list.json[0]).toMatchObject({ id: made.id, kind: "NO_SHOW", sha256: made.sha256 });
    const photo = await call(list.json[0].photo, { token: p.apiKey, raw: true });
    expect(photo.status).toBe(200);
    expect(photo.bytes.equals(img)).toBe(true);

    expect((await call(`/v1/bookings/${bookingId}/proofs`, { token: other.apiKey })).status).toBe(404);
    expect((await call(`/v1/bookings/${bookingId}/proofs/${made.id}/photo`, { token: other.apiKey, raw: true })).status).toBe(404);
    expect((await call(`/v1/bookings/${bookingId}/proofs`)).status).toBe(401);
  });

  it("l'équipe consulte la liste et la photo ; accès refusé sans authentification", async () => {
    const p = await mkPartner(), d = await mkDriver();
    const { rideId } = await mission(p, d);
    const img = jpeg(5, 500);
    const made = (await call(`/driver/rides/${rideId}/proofs`, { token: d.token, body: proof({ image: b64(img) }) })).json;
    expect((await call(`/admin/rides/${rideId}/proofs`)).status).toBe(401);
    const list = await call(`/admin/rides/${rideId}/proofs`, { admin: true });
    expect(list.json).toHaveLength(1);
    const photo = await call(`/admin/proofs/${made.id}/photo`, { admin: true, raw: true });
    expect(photo.bytes.equals(img)).toBe(true);
    expect((await call(`/admin/proofs/${made.id}/photo`, { raw: true })).status).toBe(401);
  });
});
