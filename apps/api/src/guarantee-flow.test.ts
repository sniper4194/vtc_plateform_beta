import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { DispatchService } from "./dispatch.service";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;
let dispatch: DispatchService;

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
  dispatch = app.get(DispatchService);
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "MeetingPoint","RideProof","Incident","IdentityCheck","DriverPenalty","RescueRequest","Notification","OtpCode","WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE');
});

const CDG = { address: "Aéroport CDG T2", lat: 49.0097, lng: 2.5479 };
const PARIS = { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 };
async function partner(name = "P") { return (await call("/admin/partners", { admin: true, body: { name, webhookUrl: "https://partenaire.example/hook" } })).json; }
async function book(p: { apiKey: string }, inMin: number) {
  const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: new Date(Date.now() + inMin * 60_000).toISOString(), category: "BERLINE", passengers: 1, luggage: 1 } });
  const b = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": `k-${Math.random()}` }, body: { quoteId: q.json.quoteId, externalReference: "BK", passenger: { firstName: "Noor", lastName: "Haddad", phone: "+31612345678", language: "en" } } });
  return prisma.ride.findFirstOrThrow({ where: { bookingId: b.json.id } });
}

describe("garantie de prise en charge", () => {
  it("à l'approche de la prise en charge sans chauffeur : relance, partenaire averti, alerte ; une seule fois", async () => {
    const p = await partner();
    const soon = await book(p, 120); // dans 2 h : dans la fenêtre (3 h par défaut)
    const later = await book(p, 3 * 24 * 60); // dans 3 jours : hors fenêtre
    await dispatch.sweep();
    await dispatch.sweep();
    expect(await prisma.rideEvent.count({ where: { rideId: soon.id, type: "dispatch.at_risk" } })).toBe(1);
    expect(await prisma.rideEvent.count({ where: { rideId: soon.id, type: "dispatch.reset" } })).toBe(1);
    expect(await prisma.rideEvent.count({ where: { rideId: later.id, type: "dispatch.at_risk" } })).toBe(0);
    expect(await prisma.webhookDelivery.count({ where: { eventType: "booking.at_risk" } })).toBe(1);
    const alerts = (await call("/admin/alerts", { admin: true })).json;
    expect(alerts.filter((a: any) => a.reason === "AT_RISK").map((a: any) => a.rideId)).toEqual([soon.id]);
  });

  it("désactivable : GUARANTEE_ALERT_MIN=0", async () => {
    process.env.GUARANTEE_ALERT_MIN = "0";
    try {
      const p = await partner();
      const soon = await book(p, 60);
      await dispatch.sweep();
      expect(await prisma.rideEvent.count({ where: { rideId: soon.id, type: "dispatch.at_risk" } })).toBe(0);
    } finally { delete process.env.GUARANTEE_ALERT_MIN; }
  });
});

describe("fiabilité mesurée", () => {
  it("calcule les taux de chaque partenaire à partir de ses courses, sans voir celles des autres", async () => {
    const a = await partner("Agence A"), b = await partner("Agence B");
    const r1 = await book(a, 90), r2 = await book(a, 100), r3 = await book(b, 110);
    // les prises en charge sont « passées » et les événements posés comme ils l'auraient été
    const past = (m: number) => new Date(Date.now() - m * 60_000);
    await prisma.ride.update({ where: { id: r1.id }, data: { pickupAt: past(120), status: "COMPLETED" } });
    await prisma.rideEvent.createMany({ data: [
      { rideId: r1.id, type: "ride.assigned", actor: "t", createdAt: past(120 + 24 * 60) },
      { rideId: r1.id, type: "ride.arrived", actor: "t", createdAt: past(125) },
    ] });
    await prisma.ride.update({ where: { id: r2.id }, data: { pickupAt: past(60), status: "COMPLETED" } });
    await prisma.rideEvent.createMany({ data: [
      { rideId: r2.id, type: "ride.assigned", actor: "t", createdAt: past(90) },
      { rideId: r2.id, type: "ride.arrived", actor: "t", createdAt: past(55) }, // 5 min de retard
    ] });
    await prisma.ride.update({ where: { id: r3.id }, data: { pickupAt: past(30) } });

    const mine = (await call("/v1/reliability?days=7", { token: a.apiKey })).json;
    expect(mine).toMatchObject({ days: 7, missions: 2, completed: 2 });
    expect(mine.assignedEarly).toEqual({ num: 1, den: 2, pct: 50 });
    expect(mine.arrivedOnTime).toEqual({ num: 1, den: 2, pct: 50 });
    expect((await call("/v1/reliability", { token: b.apiKey })).json.missions).toBe(1);
    expect((await call("/v1/reliability")).status).toBe(401);

    const admin = (await call("/admin/reliability?days=7", { admin: true })).json;
    expect(admin.total.missions).toBe(3);
    expect(admin.partners.map((x: any) => x.partner)).toEqual(["Agence A", "Agence B"]);
    expect(admin.partners[1].neverAssigned).toBe(1);
  });
});
