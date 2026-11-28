import { manualAssignment } from "../test/manual-assignment";
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
  it("TPMR : la déclaration ne suffit pas, il faut la validation de la tour", () => {
    expect(hasNeeds({ features: ["TPMR"] }, ["TPMR"])).toBe(false);
    expect(hasNeeds({ features: ["TPMR"], tpmrVerifiedAt: new Date() }, ["TPMR"])).toBe(true);
    expect(hasNeeds({ features: [], tpmrVerifiedAt: new Date() }, ["TPMR"])).toBe(false);
    // le fauteuil pliable (coffre) reste une simple déclaration
    expect(hasNeeds({ features: ["WHEELCHAIR"] }, ["WHEELCHAIR"])).toBe(true);
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
    const bad = await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, plain.id));
    expect(bad.status).toBe(409);
    expect(bad.json.message).toMatch(/équipé/);
    expect((await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, equipped.id))).status).toBe(201);
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

describe("véhicule adapté TPMR", () => {
  it("déclaré par le chauffeur, validé par la tour ; course TPMR proposée seulement après validation", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const d = await mkDriver();
    const v = (await call("/driver/me", { token: d.token })).json.vehicles[0];
    // La tour ne peut pas valider un véhicule que le chauffeur n'a pas déclaré.
    expect((await call(`/admin/vehicles/${v.id}/tpmr`, { admin: true, body: { verified: true } })).status).toBe(409);
    const decl = await call(`/driver/vehicles/${v.id}/features`, { token: d.token, body: { features: ["TPMR"] } });
    expect(decl.json).toEqual({ features: ["TPMR"], tpmrVerified: false });
    const first = await book(p, ["TPMR"]);
    expect(first.status).toBe(201);
    expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(0);
    expect((await call(`/admin/vehicles/${v.id}/tpmr`, { admin: true, body: { verified: true } })).status).toBe(201);
    expect((await call("/driver/me", { token: d.token })).json.vehicles[0].tpmrVerifiedAt).toBeTruthy();
    await book(p, ["TPMR"]);
    expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(1);
    // Le chauffeur retire TPMR : la validation tombe ; s'il le redéclare, il faut revalider.
    await call(`/driver/vehicles/${v.id}/features`, { token: d.token, body: { features: [] } });
    const again = await call(`/driver/vehicles/${v.id}/features`, { token: d.token, body: { features: ["TPMR"] } });
    expect(again.json.tpmrVerified).toBe(false);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } })).tpmrVerifiedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "vehicle.tpmr_verified", entityId: v.id } })).toBe(1);
  });
});

describe("CliCab Women : conductrice demandée", () => {
  it("course proposée seulement aux conductrices validées par la tour ; attribution manuelle refusée sinon", async () => {
    const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
    const her = await mkDriver(), him = await mkDriver();
    // La tour ne valide qu'une conductrice qui s'est déclarée.
    expect((await call(`/admin/drivers/${her.id}/women`, { admin: true, body: { verified: true } })).status).toBe(409);
    expect((await call("/driver/women", { token: her.token, body: { enabled: true } })).json).toEqual({ womanDeclared: true, womanVerified: false });
    const first = await book(p, ["WOMEN_DRIVER"]);
    expect(first.status).toBe(201);
    expect((await call("/driver/offers", { token: her.token })).json).toHaveLength(0); // déclarée mais pas encore validée
    expect((await call(`/admin/drivers/${her.id}/women`, { admin: true, body: { verified: true } })).status).toBe(201);
    expect((await call("/driver/me", { token: her.token })).json).toMatchObject({ womanDeclared: true, womanVerified: true });
    const b = await book(p, ["WOMEN_DRIVER"]);
    expect((await call("/driver/offers", { token: her.token })).json).toHaveLength(1);
    expect((await call("/driver/offers", { token: him.token })).json).toHaveLength(0);
    const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
    expect((await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, him.id))).status).toBe(409);
    // Les courses normales restent proposées à tout le monde.
    await book(p);
    expect((await call("/driver/offers", { token: him.token })).json).toHaveLength(1);
    // « Conductrice » n'est pas un équipement de véhicule.
    const v = (await call("/driver/me", { token: him.token })).json.vehicles[0];
    expect((await call(`/driver/vehicles/${v.id}/features`, { token: him.token, body: { features: ["WOMEN_DRIVER"] } })).status).toBe(422);
    // Retirer sa déclaration fait tomber la validation.
    await call("/driver/women", { token: her.token, body: { enabled: false } });
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: her.id } })).womanVerifiedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "driver.women_verified", entityId: her.id } })).toBe(1);
  });
});

describe("création d'un chauffeur en double", () => {
  it("répond 409 (et non 500) si le téléphone est déjà utilisé", async () => {
    const body = { firstName: "Ines", lastName: "Varga", phone: "+33600099001", email: "ines.varga@test.fr" };
    expect((await call("/admin/drivers", { admin: true, body })).status).toBe(201);
    const again = await call("/admin/drivers", { admin: true, body: { ...body, email: "autre@test.fr" } });
    expect(again.status).toBe(409);
    expect(again.json.message).toMatch(/Déjà utilisé/);
  });
});

