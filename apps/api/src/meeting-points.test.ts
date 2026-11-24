import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { nearestPoint } from "./meeting-points";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;

async function call(path: string, opts: { token?: string; admin?: boolean; body?: unknown; headers?: Record<string, string>; raw?: boolean } = {}) {
  const res = await fetch(base + path, {
    method: opts.body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.admin ? { "x-admin-token": "test-admin-token-test-admin-token" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), json: null as any };
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, bytes: Buffer.alloc(0) };
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
const jpeg = (fill = 4) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, fill)]);

let n = 0;
async function driverToken() {
  n++;
  const r = await call("/admin/drivers", { admin: true, body: { firstName: `M${n}`, lastName: "Test", phone: `+3360002${String(n).padStart(4, "0")}`, email: `m${n}@test.fr` } });
  return (await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } })).json.token as string;
}
async function trackingToken() {
  const p = (await call("/admin/partners", { admin: true, body: { name: "P" } })).json;
  const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: new Date(Date.now() + 3 * 86400_000).toISOString(), category: "BERLINE", passengers: 1, luggage: 1 } });
  const b = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": `k-${Math.random()}` }, body: { quoteId: q.json.quoteId, externalReference: "BK", passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000", language: "pt" } } });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.json.id } });
  return booking.trackingToken!;
}

describe("point le plus proche", () => {
  it("garde le plus proche dans le rayon, rien au-delà", () => {
    const pts = [{ id: "a", lat: 49.0105, lng: 2.5479 }, { id: "b", lat: 49.0099, lng: 2.548 }, { id: "c", lat: 48.95, lng: 2.4 }];
    expect(nearestPoint(pts, CDG, 500)?.id).toBe("b");
    expect(nearestPoint(pts, CDG, 500)?.distanceM).toBeLessThan(50);
    expect(nearestPoint([pts[2]], CDG, 500)).toBeNull();
  });
});

describe("points de rendez-vous", () => {
  it("proposé par un chauffeur, invisible avant validation, montré au voyageur une fois validé", async () => {
    const d = await driverToken();
    const tk = await trackingToken();
    const img = jpeg(9);
    const s = await call("/driver/meeting-points", { token: d, body: { label: "Terminal 2E, porte 8", note: "Sortie des arrivées, à droite du café", image: img.toString("base64"), lat: 49.0099, lng: 2.548, accuracyM: 6 } });
    expect(s.status).toBe(201);
    expect(s.json.status).toBe("PENDING");
    expect((await call(`/track/${tk}`)).json.meetingPoint).toBeNull(); // pas encore validé

    expect((await call(`/admin/meeting-points/${s.json.id}/review`, { body: { status: "APPROVED" } })).status).toBe(401);
    const ok = await call(`/admin/meeting-points/${s.json.id}/review`, { admin: true, body: { status: "APPROVED", label: "Terminal 2E, porte 8 (arrivées)" } });
    expect(ok.json).toMatchObject({ status: "APPROVED", label: "Terminal 2E, porte 8 (arrivées)" });

    const t = (await call(`/track/${tk}`)).json;
    expect(t.meetingPoint).toMatchObject({ label: "Terminal 2E, porte 8 (arrivées)", note: "Sortie des arrivées, à droite du café" });
    const photo = await call(t.meetingPoint.photoUrl, { raw: true });
    expect(photo.status).toBe(200);
    expect(photo.bytes.equals(img)).toBe(true);
    // une autre photo (id quelconque) n'est pas servie par ce lien
    expect((await call(`/track/${tk}/meeting-point/00000000-0000-0000-0000-000000000000`, { raw: true })).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { entity: "MeetingPoint", action: "meeting_point.approved" } })).toBe(1);
  });

  it("un point refusé ou trop loin n'est jamais montré", async () => {
    const d = await driverToken();
    const tk = await trackingToken();
    const far = await call("/driver/meeting-points", { token: d, body: { label: "Orly, porte 3", image: jpeg().toString("base64"), lat: 48.7262, lng: 2.3652 } });
    await call(`/admin/meeting-points/${far.json.id}/review`, { admin: true, body: { status: "APPROVED" } });
    const near = await call("/driver/meeting-points", { token: d, body: { label: "CDG porte 10", image: jpeg().toString("base64"), lat: 49.0098, lng: 2.5479 } });
    await call(`/admin/meeting-points/${near.json.id}/review`, { admin: true, body: { status: "REJECTED" } });
    expect((await call(`/track/${tk}`)).json.meetingPoint).toBeNull();
  });

  it("refuse un fichier qui n'est pas une image, un libellé trop court, et un chauffeur non connecté", async () => {
    const d = await driverToken();
    expect((await call("/driver/meeting-points", { token: d, body: { label: "Porte 8", image: Buffer.from("x".repeat(300)).toString("base64"), lat: 49, lng: 2.5 } })).status).toBe(422);
    expect((await call("/driver/meeting-points", { token: d, body: { label: "P", image: jpeg().toString("base64"), lat: 49, lng: 2.5 } })).status).toBe(422);
    expect((await call("/driver/meeting-points", { body: { label: "Porte 8", image: jpeg().toString("base64"), lat: 49, lng: 2.5 } })).status).toBe(401);
    // la liste de l'équipe montre la proposition et sa photo
    await call("/driver/meeting-points", { token: d, body: { label: "Porte 8", image: jpeg(2).toString("base64"), lat: 49, lng: 2.5 } });
    const list = await call("/admin/meeting-points?status=PENDING", { admin: true });
    expect(list.json).toHaveLength(1);
    expect((await call(list.json[0].photo, { admin: true, raw: true })).status).toBe(200);
  });
});
