import { manualAssignment } from "../test/manual-assignment";
import { NotificationsService } from "./notifications";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { BookingsService, cancellationFeeCents } from "./bookings.service";
import { DISPATCH, DispatchService } from "./dispatch.service";
import { signWebhook } from "./security";
import { PenaltiesService } from "./penalties.service";
import { IdentityService } from "./identity.service";
import { DeadlinesService } from "./deadlines.service";
import { RescueService } from "./rescue.service";
import { WebhooksService } from "./webhooks.service";
import { FlightsService } from "./flights.service";
import { RoutingService } from "./routing";
import { SmsService } from "./sms";
import { EmailService } from "./email";
import { OTP, OtpService } from "./otp.service";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;
let dispatch: DispatchService;
let webhooks: WebhooksService;
let flights: FlightsService;

// récepteur de webhooks de test
let hookServer: Server;
let hookUrl: string;
let received: { headers: any; body: string }[] = [];
let hookStatus = 200;

async function call(path: string, opts: { method?: string; token?: string; admin?: boolean; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.admin ? { "x-admin-token": "test-admin-token-test-admin-token" } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const CDG = { address: "Aéroport CDG T2", lat: 49.0097, lng: 2.5479 };
const PARIS = { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 };
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

async function mkPartner(withHook = true) {
  const r = await call("/admin/partners", { admin: true, body: { name: "Booking (test)", webhookUrl: withHook ? hookUrl : undefined } });
  expect(r.status).toBe(201);
  return r.json as { partnerId: string; apiKey: string; webhookSecret: string | null };
}

let driverSeq = 0;
async function mkDriver(opts: { category?: string; lat?: number; lng?: number; docs?: boolean } = {}) {
  const n = ++driverSeq;
  const r = await call("/admin/drivers", {
    admin: true,
    body: {
      firstName: `Chauffeur${n}`, lastName: "Test", phone: `+3360000${String(n).padStart(4, "0")}`, email: `d${n}@test.fr`,
      vehicle: { plate: `AA-${String(n).padStart(3, "0")}-BB`, make: "Toyota", model: "Camry", category: opts.category ?? "BERLINE" },
    },
  });
  const id: string = r.json.id;
  if (opts.docs !== false) {
    await prisma.document.createMany({
      data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: `k/${type}`, status: "APPROVED" as const })),
    });
    const ap = await call(`/admin/drivers/${id}/approve`, { admin: true, method: "POST", body: {} });
    expect(ap.status).toBe(201);
  }
  const login = await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } });
  const token: string = login.json.token;
  if (opts.docs !== false) {
    expect((await call("/driver/availability", { token, body: { availability: "AVAILABLE" } })).status).toBe(201);
    await call("/driver/location", { token, body: { lat: opts.lat ?? 48.86, lng: opts.lng ?? 2.35 } });
  }
  return { id, token, phone: r.json.phone as string };
}

async function mkBooking(p: { apiKey: string }, over: Record<string, unknown> = {}, key = `k-${Math.random()}`, extra: Record<string, unknown> = {}) {
  const q = await call("/v1/quotes", {
    token: p.apiKey,
    body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 2, luggage: 1, flightNumber: "AF1234", ...over },
  });
  expect(q.status).toBe(201);
  const b = await call("/v1/bookings", {
    token: p.apiKey, headers: { "idempotency-key": key },
    body: { quoteId: q.json.quoteId, externalReference: "BK-1", passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000", language: "pt" }, ...extra },
  });
  return { quote: q.json, res: b };
}

beforeAll(async () => {
  hookServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = hookStatus;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => hookServer.listen(0, "127.0.0.1", r));
  hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;

  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  dispatch = app.get(DispatchService);
  webhooks = app.get(WebhooksService);
  flights = app.get(FlightsService);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await new Promise((r) => hookServer.close(r));
});

beforeEach(async () => {
  received = [];
  hookStatus = 200;
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Incident","IdentityCheck","DriverPenalty","RescueRequest","Notification","OtpCode","AdminUser","WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE',
  );
});


let rescue: RescueService;
beforeAll(() => { rescue = app.get(RescueService); });

/** Rend un chauffeur « sauveteur » (le seuil de missions est abaissé pour les tests). */
async function mkRescuer(over: { lat?: number; lng?: number; category?: string } = {}) {
  const d = await mkDriver(over);
  const r = await call("/driver/rescue/opt-in", { token: d.token, body: { enabled: true } });
  expect(r.status).toBe(201);
  return d;
}

async function assigned(driver: { id: string; token: string }, p: { apiKey: string }) {
  const { res } = await mkBooking(p);
  const offers = await call("/driver/offers", { token: driver.token });
  expect((await call(`/driver/offers/${offers.json[0].offerId}/accept`, { token: driver.token, body: {} })).status).toBe(201);
  const ride = await prisma.ride.findFirstOrThrow({ where: { driverId: driver.id } });
  return { bookingId: res.json.id as string, ride };
}

describe("sauveteurs : statut et critères", () => {
  it("refuse l'adhésion tant que les critères ne sont pas remplis, puis l'accepte", async () => {
    process.env.RESCUE_MIN_RIDES = "5";
    const d = await mkDriver();
    const s = await call("/driver/rescue/status", { token: d.token });
    expect(s.json.eligible).toBe(false);
    expect(s.json.criteria.find((c: any) => c.key === "rides").ok).toBe(false);
    expect((await call("/driver/rescue/opt-in", { token: d.token, body: { enabled: true } })).status).toBe(403);
    process.env.RESCUE_MIN_RIDES = "0";
    const ok = await call("/driver/rescue/opt-in", { token: d.token, body: { enabled: true } });
    expect(ok.json.listed).toBe(true);
    await call("/driver/rescue/opt-in", { token: d.token, body: { enabled: false } });
    expect((await call("/driver/rescue/status", { token: d.token })).json.listed).toBe(false);
  });

  it("la note ou la fiabilité en baisse fait perdre l'éligibilité", async () => {
    process.env.RESCUE_MIN_RIDES = "0";
    const d = await mkRescuer();
    await prisma.driver.update({ where: { id: d.id }, data: { reliability: 0.5 } });
    const s = await call("/driver/rescue/status", { token: d.token });
    expect(s.json.eligible).toBe(false);
    expect(s.json.listed).toBe(false);
  });
});

describe("sauveteurs : appel à l'aide", () => {
  beforeEach(() => { process.env.RESCUE_MIN_RIDES = "0"; process.env.RESCUE_BONUS_CENTS = "1000"; });

  it("liste les sauveteurs sans coordonnées, puis reprise ciblée atomique avec prime", async () => {
    const p = await mkPartner();
    const requester = await mkDriver();
    const near = await mkRescuer({ lat: 49.0, lng: 2.5 }), far = await mkRescuer();
    const plain = await mkDriver(); // éligible mais non inscrit : absent de la liste
    void plain;
    const { ride } = await assigned(requester, p);

    const list = await call(`/driver/rescue/rescuers?rideId=${ride.id}`, { token: requester.token });
    expect(list.json.map((r: any) => r.driverId)).toEqual([near.id, far.id]); // tri par proximité
    expect(JSON.stringify(list.json)).not.toContain("phone");
    expect(list.json[0].name).toMatch(/^Chauffeur\d+ T\.$/);

    const req = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, targetId: near.id, reason: "Panne de véhicule" } });
    expect(req.status).toBe(201);
    expect(req.json.notified).toBe(1);
    expect((await call("/driver/rescue/incoming", { token: far.token })).json).toHaveLength(0);
    const inc = await call("/driver/rescue/incoming", { token: near.token });
    expect(inc.json).toHaveLength(1);
    expect(JSON.stringify(inc.json)).not.toContain("Silva"); // passager non divulgué avant acceptation
    expect(inc.json[0].netCents).toBe(ride.driverNetCents + 1000);

    // un autre sauveteur ne peut pas prendre un appel ciblé
    expect((await call(`/driver/rescue/${req.json.id}/accept`, { token: far.token, body: {} })).status).toBe(403);
    const acc = await call(`/driver/rescue/${req.json.id}/accept`, { token: near.token, body: {} });
    expect(acc.status).toBe(201);

    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.driverId).toBe(near.id);
    expect(after.status).toBe("ASSIGNED");
    expect(after.driverNetCents).toBe(ride.driverNetCents + 1000);
    expect(after.driverNetCents + after.commissionCents).toBe(after.priceCents); // la prime vient de la commission
    expect((await call("/driver/rides", { token: near.token })).json[0].passenger.name).toBe("Ana Silva");
    expect((await call("/driver/rides", { token: requester.token })).json).toHaveLength(0);

    // pas de pénalité pour le demandeur, messages pour les deux, événement tracé
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: requester.id } })).reliability).toBe(1);
    expect((await prisma.notification.findMany({ where: { driverId: requester.id } })).map((n) => n.type)).toContain("RESCUE_ACCEPTED");
    const mine = await prisma.notification.findMany({ where: { driverId: near.id } });
    expect(mine.map((n) => n.type)).toEqual(expect.arrayContaining(["RESCUE_REQUEST", "RIDE_ACCEPTED"]));
    expect(await prisma.rideEvent.count({ where: { rideId: ride.id, type: "ride.rescued" } })).toBe(1);
    // le partenaire est informé du nouveau chauffeur
    expect(await prisma.webhookDelivery.count({ where: { eventType: "driver.assigned" } })).toBeGreaterThanOrEqual(2);
  });

  it("diffusion : un seul sauveteur gagne, même en course simultanée", async () => {
    const p = await mkPartner();
    const requester = await mkDriver();
    const a = await mkRescuer(), b = await mkRescuer();
    const { ride } = await assigned(requester, p);
    const req = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Malaise" } });
    expect(req.json.notified).toBe(2);
    const [r1, r2] = await Promise.all([
      call(`/driver/rescue/${req.json.id}/accept`, { token: a.token, body: {} }),
      call(`/driver/rescue/${req.json.id}/accept`, { token: b.token, body: {} }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const winner = r1.status === 201 ? a : b;
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).driverId).toBe(winner.id);
  });

  it("appel à tous par vagues : le sauveteur le plus proche d'abord, les autres à tour de rôle, et personne ne peut passer avant son tour", async () => {
    process.env.RESCUE_WAVE_SEC = "30";
    try {
      const p = await mkPartner();
      const requester = await mkDriver();
      // Lieu de prise en charge : CDG (49.0097 ; 2.5479). Du plus proche au plus éloigné : near, mid, far ; « nowhere » n'a pas de position.
      const far = await mkRescuer({ lat: 48.5, lng: 2.0 });
      const mid = await mkRescuer({ lat: 48.95, lng: 2.45 });
      const near = await mkRescuer({ lat: 49.0, lng: 2.54 });
      const nowhere = await mkRescuer({ lat: 0, lng: 0 });
      await prisma.driver.update({ where: { id: nowhere.id }, data: { lastLat: null, lastLng: null } });
      const { ride } = await assigned(requester, p);

      const req = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Panne de véhicule" } });
      expect(req.status).toBe(201);
      expect(req.json).toMatchObject({ notified: 1, candidates: 4, waveSeconds: 30 });
      const stored = await prisma.rescueRequest.findUniqueOrThrow({ where: { id: req.json.id } });
      expect(stored.queue).toEqual([near.id, mid.id, far.id, nowhere.id]); // proximité, position inconnue en dernier

      const types = async (id: string) => (await prisma.notification.findMany({ where: { driverId: id, type: "RESCUE_REQUEST" } })).length;
      const seen = async (d: { token: string }) => (await call("/driver/rescue/incoming", { token: d.token })).json.length;
      // t = 0 : seul le plus proche est prévenu et voit l'appel
      expect([await types(near.id), await types(mid.id), await types(far.id)]).toEqual([1, 0, 0]);
      expect([await seen(near), await seen(mid), await seen(far)]).toEqual([1, 0, 0]);
      // un sauveteur plus éloigné ne peut pas prendre la mission avant son tour
      const early = await call(`/driver/rescue/${req.json.id}/accept`, { token: far.token, body: {} });
      expect(early.status).toBe(403);
      expect(early.json.message).toMatch(/pas encore ouvert/);
      expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).driverId).toBe(requester.id);

      // t = 31 s : deuxième vague (mid) ; le balayage la prévient une seule fois
      await prisma.rescueRequest.update({ where: { id: req.json.id }, data: { createdAt: new Date(Date.now() - 31_000) } });
      await rescue.sweep(); await rescue.sweep();
      expect([await types(mid.id), await types(far.id)]).toEqual([1, 0]);
      expect([await seen(mid), await seen(far)]).toEqual([1, 0]);
      expect((await prisma.rescueRequest.findUniqueOrThrow({ where: { id: req.json.id } })).notifiedWave).toBe(1);

      // t = 125 s : toutes les vagues sont ouvertes, y compris le chauffeur sans position
      await prisma.rescueRequest.update({ where: { id: req.json.id }, data: { createdAt: new Date(Date.now() - 125_000) } });
      await rescue.sweep();
      expect([await types(far.id), await types(nowhere.id)]).toEqual([1, 1]);
      expect([await seen(far), await seen(nowhere)]).toEqual([1, 1]);

      // le premier qui accepte gagne, quel que soit son rang une fois son tour venu
      const win = await call(`/driver/rescue/${req.json.id}/accept`, { token: mid.token, body: {} });
      expect(win.status).toBe(201);
      expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).driverId).toBe(mid.id);
    } finally { process.env.RESCUE_WAVE_SEC = "0"; }
  });

  it("un sauveteur qui reçoit plusieurs appels voit d'abord le plus proche de lui, avec la distance", async () => {
    const p = await mkPartner();
    const rescuer = await mkRescuer({ lat: 49.0, lng: 2.54 }); // près de CDG
    const r1 = await mkDriver(), r2 = await mkDriver();
    const { ride: far } = await assigned(r1, p);
    // seconde mission : départ de Paris centre, plus éloigné du sauveteur
    await mkBooking(p, { pickup: { address: "Gare du Nord, Paris", lat: 48.8809, lng: 2.3553 }, dropoff: { address: "Orly", lat: 48.7262, lng: 2.3652 } });
    const offers = await call("/driver/offers", { token: r2.token });
    expect((await call(`/driver/offers/${offers.json[0].offerId}/accept`, { token: r2.token, body: {} })).status).toBe(201);
    const paris = await prisma.ride.findFirstOrThrow({ where: { driverId: r2.id } });
    // l'appel de Paris est lancé en premier : sans classement par proximité, il arriverait en tête (expire plus tôt)
    expect((await call("/driver/rescue/request", { token: r2.token, body: { rideId: paris.id, reason: "Panne" } })).status).toBe(201);
    expect((await call("/driver/rescue/request", { token: r1.token, body: { rideId: far.id, reason: "Retard important" } })).status).toBe(201);
    const inc = (await call("/driver/rescue/incoming", { token: rescuer.token })).json;
    expect(inc).toHaveLength(2);
    expect(inc[0].pickup).toMatch(/CDG/);
    expect(inc[0].awayKm).toBeLessThan(inc[1].awayKm);
    expect(inc[0].awayKm).toBeLessThan(2);
  });

  it("appel ciblé : pas de vagues ; réglage à 0 : tous les sauveteurs sont prévenus en même temps", async () => {
    process.env.RESCUE_WAVE_SEC = "30";
    try {
      const p = await mkPartner();
      const requester = await mkDriver();
      const a = await mkRescuer({ lat: 49.0, lng: 2.54 }), b = await mkRescuer({ lat: 48.5, lng: 2.0 });
      const { ride } = await assigned(requester, p);
      const direct = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, targetId: b.id, reason: "Retard important" } });
      expect(direct.json).toMatchObject({ notified: 1, waveSeconds: 0 });
      expect((await call("/driver/rescue/incoming", { token: b.token })).json).toHaveLength(1); // ciblé : visible tout de suite, même loin
      await call(`/driver/rescue/${direct.json.id}/cancel`, { token: requester.token, body: {} });
      process.env.RESCUE_WAVE_SEC = "0";
      const all = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Retard important" } });
      expect(all.json).toMatchObject({ notified: 2, waveSeconds: 0 });
      void a;
    } finally { process.env.RESCUE_WAVE_SEC = "0"; }
  });

  it("une seule demande ouverte par mission ; annulation possible ; impossible une fois le client sur place", async () => {
    const p = await mkPartner();
    const requester = await mkDriver();
    await mkRescuer();
    const { ride } = await assigned(requester, p);
    const body = { rideId: ride.id, reason: "Retard important" };
    const first = await call("/driver/rescue/request", { token: requester.token, body });
    expect(first.status).toBe(201);
    expect((await call("/driver/rescue/request", { token: requester.token, body })).status).toBe(409);
    expect((await call(`/driver/rescue/${first.json.id}/cancel`, { token: requester.token, body: {} })).status).toBe(201);
    expect((await call("/driver/rescue/request", { token: requester.token, body })).status).toBe(201);

    await prisma.rescueRequest.updateMany({ data: { status: "CANCELLED" } });
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "ARRIVED" } });
    expect((await call("/driver/rescue/request", { token: requester.token, body })).status).toBe(409);
  });

  it("refuse un appel pour la mission d'un autre, un sauveteur sans véhicule adapté et sa propre mission", async () => {
    const p = await mkPartner();
    const requester = await mkDriver(), other = await mkDriver();
    const van = await mkRescuer({ category: "VAN" });
    const { ride } = await assigned(requester, p);
    expect((await call("/driver/rescue/request", { token: other.token, body: { rideId: ride.id, reason: "Test test" } })).status).toBe(404);
    expect((await call(`/driver/rescue/rescuers?rideId=${ride.id}`, { token: requester.token })).json).toHaveLength(0); // le van ne convient pas
    expect((await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Test test" } })).status).toBe(409);
    void van;
  });

  it("expiration : l'appel est clos, le demandeur prévenu, l'équipe alertée ; la mission reste au demandeur", async () => {
    const p = await mkPartner();
    const requester = await mkDriver();
    const r = await mkRescuer();
    const { ride } = await assigned(requester, p);
    const req = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Panne" } });
    await rescue.sweep(new Date(Date.now() + 3600_000));
    const row = await prisma.rescueRequest.findUniqueOrThrow({ where: { id: req.json.id } });
    expect(row.status).toBe("EXPIRED");
    expect((await call(`/driver/rescue/${req.json.id}/accept`, { token: r.token, body: {} })).status).toBe(409);
    expect((await prisma.notification.findMany({ where: { driverId: requester.id } })).map((n) => n.type)).toContain("RESCUE_EXPIRED");
    const admin = await call("/admin/rescues", { admin: true });
    expect(admin.json[0].needsAttention).toBe(true);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).driverId).toBe(requester.id);
  });

  it("appel ciblé refusé : le demandeur est prévenu ; limite mensuelle ; révocation par l'admin", async () => {
    const p = await mkPartner();
    const requester = await mkDriver();
    const r = await mkRescuer();
    const { ride } = await assigned(requester, p);
    const req = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, targetId: r.id, reason: "Panne" } });
    expect((await call(`/driver/rescue/${req.json.id}/decline`, { token: r.token, body: {} })).json.status).toBe("DECLINED");
    expect((await prisma.notification.findMany({ where: { driverId: requester.id } })).map((n) => n.type)).toContain("RESCUE_DECLINED");

    for (let i = 0; i < 2; i++) await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Panne " + i } }).then((x) => call(`/driver/rescue/${x.json.id}/cancel`, { token: requester.token, body: {} }));
    expect((await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Encore" } })).status).toBe(429);

    expect((await call(`/admin/drivers/${r.id}/rescue-revoke`, { admin: true, body: {} })).status).toBe(201);
    const s = await call("/driver/rescue/status", { token: r.token });
    expect(s.json.revoked).toBe(true);
    expect((await call("/driver/rescue/opt-in", { token: r.token, body: { enabled: true } })).status).toBe(403);
    expect((await call(`/admin/drivers/${r.id}/rescue-restore`, { admin: true, body: {} })).status).toBe(201);
    expect((await call("/driver/rescue/opt-in", { token: r.token, body: { enabled: true } })).status).toBe(201);
  });

  it("la prime est plafonnée par la commission restante", async () => {
    const { rescueBonusCents } = await import("./rescue");
    expect(rescueBonusCents(5000)).toBe(1000);
    expect(rescueBonusCents(400)).toBe(400);
    expect(rescueBonusCents(-5)).toBe(0);
  });
});

describe("pénalités : restitution, sauveteur, récidive", () => {
  beforeEach(() => { process.env.RESCUE_MIN_RIDES = "0"; process.env.RESCUE_BONUS_CENTS = "1000"; });

  it("le coût est annoncé avant la décision, la restitution est pénalisée et figure au relevé de la société", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { ride } = await assigned(d, p);
    const q = await call(`/driver/rescue/cost?rideId=${ride.id}`, { token: d.token });
    expect(q.json.giveBackCents).toBe(1000); // réservation à 3 jours : palier « plus de 48 h » = forfait de 10 €
    expect(q.json.rescueCents).toBe(1000);
    // moins de 6 h avant : 150 % + frais
    await prisma.ride.update({ where: { id: ride.id }, data: { pickupAt: new Date(Date.now() + 3 * 3600_000) } });
    const late = await call(`/driver/rescue/cost?rideId=${ride.id}`, { token: d.token });
    expect(late.json.giveBackCents).toBe(Math.round(ride.driverNetCents * 1.5));
    expect(late.json.rescueCents).toBeLessThan(late.json.giveBackCents);

    expect((await call(`/driver/rides/${ride.id}/cancel`, { token: d.token, body: {} })).status).toBe(201);
    const pen = await prisma.driverPenalty.findFirstOrThrow({ where: { driverId: d.id } });
    expect(pen.kind).toBe("GIVE_BACK");
    expect(pen.amountCents).toBe(late.json.giveBackCents);
    expect((await prisma.notification.findMany({ where: { driverId: d.id } })).map((n) => n.type)).toContain("PENALTY");
  });

  it("communique le numéro de la tour de contrôle au chauffeur affecté", async () => {
    const driver = await mkDriver();
    const otherDriver = await mkDriver();
    const partner = await mkPartner();
    const { ride } = await assigned(driver, partner);
    const path = `/driver/rescue/cost?rideId=${ride.id}`;
    const previous = process.env.CONTROL_TOWER_PHONE;
    try {
      process.env.CONTROL_TOWER_PHONE = "01 99 00 00 01";
      expect((await call(path, { token: driver.token })).json.controlTowerPhone).toBe("+33199000001");
      expect((await call(path, { token: otherDriver.token })).status).toBe(404);

      process.env.CONTROL_TOWER_PHONE = "invalide";
      expect((await call(path, { token: driver.token })).json.controlTowerPhone).toBeNull();
      delete process.env.CONTROL_TOWER_PHONE;
      expect((await call(path, { token: driver.token })).json.controlTowerPhone).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.CONTROL_TOWER_PHONE;
      else process.env.CONTROL_TOWER_PHONE = previous;
    }
  });

  it("un appel de sauveteur coûte une pénalité réduite, calculée sur le délai à la demande", async () => {
    const p = await mkPartner();
    const requester = await mkDriver();
    const r = await mkRescuer();
    const { ride } = await assigned(requester, p);
    await prisma.ride.update({ where: { id: ride.id }, data: { pickupAt: new Date(Date.now() + 3 * 3600_000) } });
    const req = await call("/driver/rescue/request", { token: requester.token, body: { rideId: ride.id, reason: "Panne" } });
    expect((await call(`/driver/rescue/${req.json.id}/accept`, { token: r.token, body: {} })).status).toBe(201);
    const pen = await prisma.driverPenalty.findFirstOrThrow({ where: { driverId: requester.id } });
    expect(pen.kind).toBe("RESCUE");
    expect(pen.amountCents).toBeGreaterThanOrEqual(1000);
    expect(pen.amountCents).toBeLessThan(Math.round(ride.driverNetCents * 1.5));
    expect(pen.weight).toBe(0.5);
  });

  it("la récidive suspend le compte (48 h), la suspension se lève seule, l'équipe peut accorder une dérogation", async () => {
    const d = await mkDriver();
    const ride = await prisma.ride.findFirst();
    void ride;
    const p = await mkPartner();
    const pen = app.get(PenaltiesService);
    // trois restitutions en fenêtre → score 3 → suspension 48 h
    for (let i = 0; i < 3; i++) {
      const { ride: rr } = await assigned(d, p).catch(async () => { throw new Error("setup"); });
      await call(`/driver/rides/${rr.id}/cancel`, { token: d.token, body: {} });
      await prisma.dispatchOffer.deleteMany({}); // le chauffeur est exclu de la mission rendue ; une nouvelle réservation suit
    }
    const after = await prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe("SUSPENDED");
    expect(after.suspendedBy).toBe("auto");
    expect(after.suspendedUntil!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
    expect((await call("/driver/availability", { token: d.token, body: { availability: "AVAILABLE" } })).status).toBe(403);
    expect(await prisma.driverPenalty.count({ where: { driverId: d.id } })).toBe(3);

    await pen.sweep(new Date(Date.now() + 49 * 3600_000));
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("ACTIVE");

    // dérogation : la pénalité n'est plus due et ne compte plus
    const one = await prisma.driverPenalty.findFirstOrThrow({ where: { driverId: d.id } });
    expect((await call(`/admin/penalties/${one.id}/waive`, { admin: true, body: { reason: "Accident, constat fourni" } })).status).toBe(201);
    expect(await pen.score(prisma as any, d.id)).toBe(2);
    expect((await call("/admin/penalties", { admin: true })).json.some((x: any) => x.waived)).toBe(true);
  });

  it("à 5 points de récidive : suspension sans échéance, examen par l'équipe", async () => {
    const d = await mkDriver();
    const ride = { id: "00000000-0000-0000-0000-000000000000", driverNetCents: 4000 };
    const pen = app.get(PenaltiesService);
    let last;
    for (let i = 0; i < 5; i++) last = await pen.apply(prisma as any, d.id, ride, "GIVE_BACK", 60);
    expect(last!.sanction).toBe("REVIEW");
    const after = await prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.suspendedUntil).toBeNull();
    expect(after.suspendedBy).toBe("auto");
    await pen.sweep(new Date(Date.now() + 365 * 86400_000));
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("SUSPENDED"); // jamais levée automatiquement
  });

  it("la pénalité d'un chauffeur de société est déduite sur le relevé de la société", async () => {
    const p = await mkPartner();
    const co = await call("/admin/companies", { admin: true, body: { name: "Flotte Test" } });
    const d = await mkDriver();
    await prisma.driver.update({ where: { id: d.id }, data: { companyId: co.json.companyId } });
    const { ride } = await assigned(d, p);
    await call(`/driver/rides/${ride.id}/cancel`, { token: d.token, body: {} });
    const range = `from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 6 * 86400_000).toISOString())}`;
    const st = await call(`/company/payments?${range}`, { token: co.json.accessKey });
    const row = st.json.rows.find((r: any) => r.kind === "PENALITE");
    expect(row.netCents).toBe(-1000);
    expect(st.json.totals.penalties).toBe(1);
    expect(st.json.totals.netCents).toBe(-1000);
  });
});

describe("badge d'accès aéroport (facture de parking ADP)", () => {
  afterEach(() => { process.env.AIRPORT_BADGE_ENABLED = "0"; });

  it("sans badge : reste en ligne, ne reçoit pas les départs d'aéroport et ne peut pas les prendre ; avec badge validé, oui", async () => {
    process.env.AIRPORT_BADGE_ENABLED = "1";
    const p = await mkPartner();
    const d = await mkDriver({ lat: 49.0097, lng: 2.5479 }); // en ligne, à CDG, sans badge : la mise en ligne n'est pas bloquée
    const rideOf = async (b: { res: { json: any } }) => (await prisma.ride.findFirstOrThrow({ where: { bookingId: b.res.json.id } })).id;
    const fromCdg = { rideId: await rideOf(await mkBooking(p)) }; // départ CDG ; la création lance une première vague d'offres
    expect(await prisma.dispatchOffer.count({ where: { rideId: fromCdg.rideId, driverId: d.id } })).toBe(0);
    const forced = await call(`/admin/rides/${fromCdg.rideId}/assign`, await manualAssignment(prisma, fromCdg.rideId, d.id));
    expect(forced.status).toBe(409);
    expect(forced.json.message).toMatch(/Badge d'accès aéroport/);
    // Une course qui ne part pas d'un aéroport reste accessible.
    const fromParis = { rideId: await rideOf(await mkBooking(p, { pickup: PARIS, dropoff: CDG })) };
    expect(await prisma.dispatchOffer.count({ where: { rideId: fromParis.rideId, driverId: d.id } })).toBe(1);
    // Facture envoyée puis validée par un humain : les départs d'aéroport s'ouvrent.
    const up = await call("/driver/documents", { token: d.token, body: { type: "AIRPORT_BADGE", storageKey: "factures/adp-2026-11.pdf" } });
    expect(up.status).toBe(201);
    expect((await call(`/admin/rides/${fromCdg.rideId}/assign`, await manualAssignment(prisma, fromCdg.rideId, d.id))).status).toBe(409); // pas encore validée
    const pending = await call("/driver/deadlines", { token: d.token });
    expect(pending.json.find((x: any) => x.type === "AIRPORT_BADGE")?.label).toBe("Badge d'accès aéroport (facture parking ADP)");
    expect((await call(`/admin/documents/${up.json.id}/review`, { admin: true, body: { status: "APPROVED" } })).status).toBe(201);
    await dispatch.round(fromCdg.rideId);
    expect(await prisma.dispatchOffer.count({ where: { rideId: fromCdg.rideId, driverId: d.id } })).toBe(1);
  });

  it("la tour peut marquer le badge vérifié puis le retirer", async () => {
    process.env.AIRPORT_BADGE_ENABLED = "1";
    const p = await mkPartner();
    const d = await mkDriver({ lat: 49.0097, lng: 2.5479 });
    const ok = await call(`/admin/drivers/${d.id}/airport-badge`, { admin: true, body: { verified: true, expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10) } });
    expect(ok.status).toBe(201);
    const doc = await prisma.document.findFirstOrThrow({ where: { driverId: d.id, type: "AIRPORT_BADGE" } });
    expect(doc).toMatchObject({ status: "APPROVED", storageKey: expect.stringMatching(/^verifie-par-equipe:/) });
    const b1 = await mkBooking(p);
    const r1 = (await prisma.ride.findFirstOrThrow({ where: { bookingId: b1.res.json.id } })).id;
    expect(await prisma.dispatchOffer.count({ where: { rideId: r1, driverId: d.id } })).toBe(1);
    expect((await call(`/admin/drivers/${d.id}/airport-badge`, { admin: true, body: { verified: false } })).status).toBe(201);
    const b2 = await mkBooking(p);
    const r2 = (await prisma.ride.findFirstOrThrow({ where: { bookingId: b2.res.json.id } })).id;
    expect(await prisma.dispatchOffer.count({ where: { rideId: r2, driverId: d.id } })).toBe(0);
    expect((await call(`/admin/drivers/${d.id}/airport-badge`, { admin: true, body: { verified: true, expiresAt: "2020-01-01" } })).status).toBe(422);
  });

  it("une facture échue ne compte plus", async () => {
    process.env.AIRPORT_BADGE_ENABLED = "1";
    const p = await mkPartner();
    const d = await mkDriver({ lat: 49.0097, lng: 2.5479 });
    await prisma.document.create({ data: { driverId: d.id, type: "AIRPORT_BADGE", storageKey: "k", status: "APPROVED", expiresAt: new Date(Date.now() - 86400_000) } });
    const b = await mkBooking(p);
    const rideId = (await prisma.ride.findFirstOrThrow({ where: { bookingId: b.res.json.id } })).id;
    expect(await prisma.dispatchOffer.count({ where: { rideId, driverId: d.id } })).toBe(0);
  });
});

describe("correction d'étape par la tour de contrôle", () => {
  it("remet une course terminée trop tôt à l'étape « à bord », avec motif, trace, message au chauffeur et webhook", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    await mkBooking(p);
    const offers = await call("/driver/offers", { token: d.token });
    expect((await call(`/driver/offers/${offers.json[0].offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);
    const ride = await prisma.ride.findFirstOrThrow({ where: { driverId: d.id } });
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "COMPLETED" } });

    expect((await call(`/admin/rides/${ride.id}/revert`, { admin: true, body: { to: "IN_PROGRESS" } })).status).toBe(422); // motif obligatoire
    const ok = await call(`/admin/rides/${ride.id}/revert`, { admin: true, body: { to: "IN_PROGRESS", reason: "Terminée avant l'arrivée à destination" } });
    expect(ok.status).toBe(201);
    expect(ok.json).toEqual({ from: "COMPLETED", to: "IN_PROGRESS" });
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe("IN_PROGRESS");
    const ev = await prisma.rideEvent.findFirstOrThrow({ where: { rideId: ride.id, type: "ride.status_corrected" } });
    expect(ev.payload).toMatchObject({ from: "COMPLETED", to: "IN_PROGRESS", reason: "Terminée avant l'arrivée à destination" });
    expect(await prisma.notification.count({ where: { driverId: d.id, type: "status_corrected" } })).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { eventType: "ride.status_corrected" } })).toBeGreaterThanOrEqual(1);
    // Le chauffeur reprend normalement depuis l'étape corrigée.
    expect((await call(`/driver/rides/${ride.id}/complete`, { token: d.token, body: {} })).status).toBe(201);

    // Jamais vers une étape postérieure ou égale, ni « à attribuer ».
    expect((await call(`/admin/rides/${ride.id}/revert`, { admin: true, body: { to: "DISPATCHING", reason: "test" } })).status).toBe(422);
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "EN_ROUTE" } });
    expect((await call(`/admin/rides/${ride.id}/revert`, { admin: true, body: { to: "IN_PROGRESS", reason: "avancer" } })).status).toBe(409);
  });

  it("annule un « client absent » déclaré à tort et la prime de parrainage d'une course qui n'est plus terminée", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    await mkBooking(p);
    const offers = await call("/driver/offers", { token: d.token });
    expect((await call(`/driver/offers/${offers.json[0].offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);
    const ride = await prisma.ride.findFirstOrThrow({ where: { driverId: d.id } });
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "NO_SHOW" } });
    expect((await call(`/admin/rides/${ride.id}/revert`, { admin: true, body: { to: "ARRIVED", reason: "Le client était là" } })).json).toEqual({ from: "NO_SHOW", to: "ARRIVED" });
    const sponsor = await mkDriver();
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "COMPLETED" } });
    await prisma.referralReward.create({ data: { sponsorId: sponsor.id, filleulId: d.id, rideId: ride.id, amountCents: 100 } });
    expect((await call(`/admin/rides/${ride.id}/revert`, { admin: true, body: { to: "ASSIGNED", reason: "Mauvaise manipulation" } })).status).toBe(201);
    expect(await prisma.referralReward.count({ where: { rideId: ride.id } })).toBe(0);
  });
});

describe("import de courses CSV d'un donneur d'ordre", () => {
  const day = new Date(Date.now() + 4 * 86400_000);
  const dmy = `${String(day.getUTCDate()).padStart(2, "0")}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${day.getUTCFullYear()}`;
  const csv = [
    "Booking ID;Date;Heure;Pickup;Dropoff;Passenger;Phone;Flight;Pax;Price",
    `TZ-100;${dmy};10:30;Paris CDG Terminal 2E;Gare de Lyon, Paris;Inès Moreau;+33 6 11 22 33 44;AF1234;2;68,00 €`,
    `TZ-101;${dmy};11:00;12 rue Inconnue, Nulle-Part;Orly;Jonas Weber;+49 151 2345678;;1;`,
    `TZ-102;01/01/2020;10:00;Orly;Paris;Li Wei;+33 6 00 00 00 00;;1;`,
  ].join("\n");

  it("aperçu, attente hors Radar, puis mise au Radar par le dispatcheur, une course à la fois", async () => {
    const p = await mkPartner();
    const pv = await call("/admin/imports/preview", { admin: true, body: { partnerId: p.partnerId, csv } });
    expect(pv.status).toBe(201);
    expect(pv.json.mapping).toMatchObject({ reference: 0, pickupDate: 1, pickupTime: 2, pickupAddress: 3, dropoffAddress: 4, passengerName: 5, passengerPhone: 6, flightNumber: 7, passengers: 8, price: 9 });
    expect(pv.json.rows[0]).toMatchObject({ reference: "TZ-100", priceCents: 6800, flightNumber: "AF1234", errors: [] });
    expect(pv.json.rows[2].errors).toContain("prise en charge déjà passée");

    const imp = await call("/admin/imports", { admin: true, body: { partnerId: p.partnerId, fileName: "transferz.csv", csv } });
    expect(imp.json).toEqual({ created: 3, updated: 0, skipped: 0 });
    // Rien au Radar tant que le dispatcheur n'a rien publié.
    expect(await prisma.ride.count({ where: { booking: { partnerId: p.partnerId } } })).toBe(0);
    const list = (await call("/admin/imports/rides", { admin: true })).json.filter((r: any) => r.partner === "Booking (test)");
    const row = (ref: string) => list.find((r: any) => r.reference === ref);

    // Ligne en erreur : refusée avec la raison.
    const late = await call(`/admin/imports/rides/${row("TZ-102").id}/publish`, { admin: true, body: {} });
    expect(late.status).toBe(422);
    // Adresse inconnue (service d'adresses coupé en test) : refusée, la ligne reste en attente.
    const unknown = await call(`/admin/imports/rides/${row("TZ-101").id}/publish`, { admin: true, body: {} });
    expect(unknown.status).toBe(422);
    expect(unknown.json.message).toMatch(/Adresse introuvable : départ/);

    const ok = await call(`/admin/imports/rides/${row("TZ-100").id}/publish`, { admin: true, body: {} });
    expect(ok.status).toBe(201);
    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: ok.json.rideId }, include: { booking: true } });
    expect(ride).toMatchObject({ status: "DISPATCHING", priceCents: 6800, pickupAddress: "Paris CDG Terminal 2E" });
    expect(ride.booking).toMatchObject({ externalReference: "TZ-100", passengerFirstName: "Inès", passengerLastName: "Moreau", flightNumber: "AF1234" });
    expect(ride.commissionCents + ride.driverNetCents).toBe(6800);
    expect((await call(`/admin/imports/rides/${row("TZ-100").id}/publish`, { admin: true, body: {} })).status).toBe(409); // pas deux fois

    // Réimport du même fichier : la course publiée n'est pas recréée.
    expect((await call("/admin/imports", { admin: true, body: { partnerId: p.partnerId, csv } })).json).toEqual({ created: 0, updated: 2, skipped: 1 });
    // Écarter efface les données du voyageur.
    expect((await call(`/admin/imports/rides/${row("TZ-102").id}/discard`, { admin: true, body: {} })).status).toBe(201);
    const gone = await prisma.importedRide.findUniqueOrThrow({ where: { id: row("TZ-102").id } });
    expect(gone).toMatchObject({ status: "DISCARDED", data: {} });
  });
});

describe("paiement à bord par carte", () => {
  it("réservé aux chauffeurs qui déclarent un terminal ; les autres gardent leurs autres courses", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const rideOf = async (b: { res: { json: any } }) => prisma.ride.findFirstOrThrow({ where: { bookingId: b.res.json.id } });
    const onBoard = await rideOf(await mkBooking(p, {}, `k-${Math.random()}`, { payOnBoard: true }));
    expect(onBoard.payOnBoard).toBe(true);
    expect(await prisma.dispatchOffer.count({ where: { rideId: onBoard.id, driverId: d.id } })).toBe(0);
    const refused = await call(`/admin/rides/${onBoard.id}/assign`, await manualAssignment(prisma, onBoard.id, d.id));
    expect(refused.status).toBe(409);
    expect(refused.json.message).toMatch(/terminal de paiement/);
    const normal = await rideOf(await mkBooking(p));
    expect(await prisma.dispatchOffer.count({ where: { rideId: normal.id, driverId: d.id } })).toBe(1);
    // Simple déclaration du chauffeur : la course payée à bord lui est alors proposée, avec le montant à encaisser.
    expect((await call("/driver/card-terminal", { token: d.token, body: { enabled: true } })).status).toBe(201);
    expect((await call("/driver/me", { token: d.token })).json.cardTerminal).toBe(true);
    await dispatch.round(onBoard.id);
    const offerRow = await prisma.dispatchOffer.findFirstOrThrow({ where: { rideId: onBoard.id, driverId: d.id, status: "PENDING" } });
    const offer = (await call("/driver/offers", { token: d.token })).json.find((o: any) => o.offerId === offerRow.id);
    expect(offer.payOnBoard).toEqual({ collectCents: onBoard.priceCents });
    expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);
    const mission = await call(`/driver/rides/${onBoard.id}`, { token: d.token });
    expect(mission.json.payOnBoard).toEqual({ collectCents: onBoard.priceCents, commissionCents: expect.any(Number) });
  });
});

describe("critères du véhicule à l'admission et à l'attribution", () => {
  afterEach(() => { process.env.VEHICLE_RULES = "0"; });
  const goodFacts = { fuel: "THERMAL" as const, firstRegistrationAt: new Date(Date.now() - 365 * 86400_000), doors: 4, lengthMm: 4800, widthMm: 1850, powerKw: 120 };

  it("refuse la validation sans carte grise ni véhicule conforme, puis l'accepte", async () => {
    process.env.VEHICLE_RULES = "1";
    const d = await mkDriver({ docs: false });
    await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: d.id, type: type as any, storageKey: "k", status: "APPROVED" as const })) });
    const a = await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} });
    expect(a.status).toBe(409);
    expect(a.json.missing).toEqual(expect.arrayContaining(["REGISTRATION_CERT", "TECHNICAL_INSPECTION"]));
    await prisma.document.create({ data: { driverId: d.id, type: "REGISTRATION_CERT", storageKey: "k", status: "APPROVED" } });
    // un contrôle technique sans date d'échéance ne prouve rien : refusé
    await prisma.document.create({ data: { driverId: d.id, type: "TECHNICAL_INSPECTION", storageKey: "k", status: "APPROVED" } });
    expect((await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} })).json.missing).toContain("TECHNICAL_INSPECTION");
    await prisma.document.updateMany({ where: { driverId: d.id, type: "TECHNICAL_INSPECTION" }, data: { expiresAt: new Date(Date.now() + 200 * 86400_000) } });
    const ids = await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} });
    expect(ids.status).toBe(409);
    expect(ids.json.missingIdentifiers).toHaveLength(3); // carte pro, Siret, numéro de registre
    expect((await call("/driver/identity", { token: d.token, body: { siret: "12345678901234", revtcNumber: "EVTC-075-0001", proCardNumber: "75-1234567" } })).status).toBe(201);
    const b = await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} });
    expect(b.status).toBe(409);
    expect(b.json.vehicleProblems[0].problems.length).toBeGreaterThan(0);
    await prisma.vehicle.updateMany({ where: { driverId: d.id }, data: goodFacts });
    expect((await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} })).status).toBe(201);
    expect((await call("/admin/drivers", { admin: true })).json.find((x: any) => x.id === d.id).vehicles[0].compliance.ok).toBe(true);
  });

  it("un chauffeur dont le véhicule n'est plus conforme ne reçoit plus d'offre ni de reprise", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const requester = await mkDriver();
    await prisma.vehicle.updateMany({ data: goodFacts });
    process.env.VEHICLE_RULES = "1";
    await prisma.vehicle.updateMany({ where: { driverId: d.id }, data: { firstRegistrationAt: new Date(Date.now() - 9 * 365 * 86400_000) } }); // thermique de 9 ans : trop ancien
    await mkBooking(p);
    expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(0);
    expect((await call("/driver/offers", { token: requester.token })).json).toHaveLength(1);
    // la même règle protège l'attribution manuelle
    const ride = await prisma.ride.findFirstOrThrow();
    expect((await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, d.id))).status).toBe(409);
    expect((await call(`/admin/rides/${ride.id}/assign`, await manualAssignment(prisma, ride.id, requester.id))).status).toBe(201);
  });
});

describe("revenu minimal par course et justificatif de réservation préalable", () => {
  it("le prix client trop bas est complété : le chauffeur touche au moins 9 € net, la commission est réduite", async () => {
    const p = await mkPartner();
    const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: PARIS, dropoff: { address: "12 rue de Rivoli, Paris", lat: 48.857, lng: 2.353 }, pickupAt: inDays(3), category: "BERLINE", passengers: 1, luggage: 0 } });
    expect(q.status).toBe(201);
    const row = await prisma.quote.findFirstOrThrow({});
    expect(row.driverNetCents).toBeGreaterThanOrEqual(900);
    expect(row.driverNetCents + row.commissionCents).toBe(row.priceCents);
    const { minDriverPayCents, driverOfferCents } = await import("./ladder");
    expect(minDriverPayCents()).toBe(900);
    // le prix proposé de l'échelle ne descend jamais sous le plancher
    const cfg = { enabled: true, startRatio: 0.5, rampFromMin: 1440, rampToMin: 60, stepCents: 10 };
    expect(driverOfferCents(1000, new Date(Date.now() + 3 * 86400_000), new Date(), cfg)).toBe(900);
    expect(driverOfferCents(600, new Date(Date.now() + 3 * 86400_000), new Date(), cfg)).toBe(600); // plafond sous le plancher : le plafond
  });

  it("le justificatif de réservation préalable reprend les mentions exigées et signale ce qui manque", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { ride } = await assigned(d, p);
    const before = await call(`/driver/rides/${ride.id}/justificatif`, { token: d.token });
    expect(before.status).toBe(200);
    expect(before.json.complete).toBe(false);
    expect(before.json.missing).toEqual(expect.arrayContaining(["numéro d'inscription au registre des exploitants de VTC", "numéro Siren/Siret"]));
    await call("/driver/identity", { token: d.token, body: { businessName: "Girard Transport", siret: "12345678901234", revtcNumber: "EVTC-075-0001" } });
    const j = (await call(`/driver/rides/${ride.id}/justificatif`, { token: d.token })).json;
    expect(j.complete).toBe(true);
    const labels = j.lines.map((l: string[]) => l[0]);
    expect(labels).toEqual(expect.arrayContaining(["Exploitant (VTC)", "N° d'inscription au registre des VTC (REVTC)", "Client", "Téléphone du client", "Réservation effectuée le", "Prise en charge souhaitée le", "Lieu de prise en charge"]));
    expect(JSON.stringify(j.lines)).toContain("Ana Silva");
    // le justificatif d'une mission n'est visible que de son chauffeur
    const other = await mkDriver();
    expect((await call(`/driver/rides/${ride.id}/justificatif`, { token: other.token })).status).toBe(404);
  });

  it("une voiture de collection est exemptée de la limite d'âge, pas du reste", async () => {
    process.env.VEHICLE_RULES = "1";
    const { checkVehicle } = await import("./vehicle-rules");
    const old = { seats: 5, fuel: "THERMAL" as const, firstRegistrationAt: new Date("2005-01-01"), doors: 4, lengthMm: 4800, widthMm: 1850, powerKw: 110 };
    expect(checkVehicle(old).ok).toBe(false);
    expect(checkVehicle({ ...old, collector: true }).ok).toBe(true);
    expect(checkVehicle({ ...old, collector: true, doors: 2 }).ok).toBe(false);
    process.env.VEHICLE_RULES = "0";
  });
});

describe("vérification d'identité par selfie", () => {
  afterEach(() => { process.env.IDENTITY_CHECKS = "0"; });
  const on = () => { process.env.IDENTITY_CHECKS = "1"; }; // à activer APRÈS la création du chauffeur (qui se met en ligne sans selfie)
  // Un JPEG minimal valide pour le contrôle de format (en-tête FFD8) : le contenu n'est pas analysé.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString("base64");

  it("première mise en ligne : photo de référence validée par l'équipe, puis selfie à chaque prise de service", async () => {
    const d = await mkDriver();
    on();
    const online = () => call("/driver/availability", { token: d.token, body: { availability: "AVAILABLE" } });
    await call("/driver/availability", { token: d.token, body: { availability: "SUSPENDED" } });
    expect((await online()).status).toBe(403); // aucune photo
    expect((await online()).json.code).toBe("IDENTITY_CHECK_REQUIRED");

    const ref = await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } });
    expect(ref.json).toMatchObject({ kind: "REFERENCE", status: "PENDING" });
    expect((await online()).json.message).toMatch(/validation/); // en attente de l'équipe

    const list = await call("/admin/identity-checks?status=PENDING", { admin: true });
    expect(list.json).toHaveLength(1);
    expect(list.json[0].image).toMatch(/^data:image\/jpeg;base64,/);
    // refus sans motif impossible ; avec motif, le chauffeur reprend une photo
    expect((await call(`/admin/identity-checks/${list.json[0].id}/review`, { admin: true, body: { decision: "REJECT" } })).status).toBe(422);
    expect((await call(`/admin/identity-checks/${list.json[0].id}/review`, { admin: true, body: { decision: "REJECT", reason: "Photo floue" } })).status).toBe(201);
    expect((await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } })).json.kind).toBe("REFERENCE");
    const again = (await call("/admin/identity-checks?status=PENDING", { admin: true })).json;
    expect((await call(`/admin/identity-checks/${again[0].id}/review`, { admin: true, body: { decision: "APPROVE" } })).status).toBe(201);
    expect((await online()).status).toBe(201);

    // le selfie expire : le chauffeur est remis hors ligne par le balayage, et doit en reprendre un (cette fois c'est un selfie de service)
    await prisma.driver.update({ where: { id: d.id }, data: { identityVerifiedAt: new Date(Date.now() - 13 * 3600_000) } });
    await app.get(IdentityService).sweep();
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).availability).toBe("SUSPENDED");
    expect((await online()).status).toBe(403);
    expect((await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } })).json).toMatchObject({ kind: "SHIFT", status: "VALID" });
    expect((await online()).status).toBe(201);
    expect((await call("/driver/identity", { token: d.token })).json.selfie.mustVerify).toBe(false);
  });

  it("la photo de référence sert de photo de profil : visible du chauffeur et de l'équipe, jamais des autres chauffeurs", async () => {
    const d = await mkDriver();
    const other = await mkDriver();
    expect((await call("/driver/identity", { token: d.token })).json.photo).toBeNull();
    expect((await call(`/admin/drivers/${d.id}/photo`, { admin: true })).json).toMatchObject({ photo: null, status: "NONE" });
    await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } });
    const mine = (await call("/driver/identity", { token: d.token })).json.photo;
    expect(mine.status).toBe("PENDING");
    expect(mine.photo).toMatch(/^data:image\/jpeg;base64,/);
    expect((await call(`/admin/drivers/${d.id}/photo`, { admin: true })).json.photo).toBe(mine.photo);
    expect((await call("/driver/identity", { token: other.token })).json.photo).toBeNull();
    expect((await call(`/admin/drivers/${d.id}/photo`)).status).toBe(401); // sans identifiants d'équipe
    const pending = (await call("/admin/identity-checks?status=PENDING", { admin: true })).json;
    await call(`/admin/identity-checks/${pending[0].id}/review`, { admin: true, body: { decision: "APPROVE" } });
    expect((await call("/driver/identity", { token: d.token })).json.photo.status).toBe("VALID");
  });

  it("le voyageur voit la photo du chauffeur seulement si le chauffeur y a consenti, que la photo est validée et que la course est en cours", async () => {
    const d = await mkDriver();
    const p = await mkPartner(false);
    const other = await mkPartner(false);
    const { bookingId, ride } = await assigned(d, p);
    const get = (key: string) => fetch(`${base}/v1/bookings/${bookingId}/driver-photo`, { headers: { authorization: `Bearer ${key}` } });
    const view = (await call(`/v1/bookings/${bookingId}`, { token: p.apiKey })).json;
    expect(view.driver.photoUrl).toBeNull(); // pas de consentement
    expect(view.trackingUrl).toMatch(/\/suivi\/[A-Za-z0-9_-]{20,}$/);
    const track = () => fetch(`${base}/track/${view.trackingUrl.split("/suivi/")[1]}`).then((r) => r.json());
    const trackPhoto = () => fetch(`${base}/track/${view.trackingUrl.split("/suivi/")[1]}/photo`);

    await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } });
    const pending = (await call("/admin/identity-checks?status=PENDING", { admin: true })).json;
    await call(`/admin/identity-checks/${pending[0].id}/review`, { admin: true, body: { decision: "APPROVE" } });
    expect((await get(p.apiKey)).status).toBe(404); // photo validée mais aucun consentement
    expect((await trackPhoto()).status).toBe(404);
    expect((await track()).driver.photoUrl).toBeNull();

    expect((await call("/driver/identity", { token: d.token })).json.photoConsent.given).toBe(false);
    expect((await call("/driver/identity/photo-consent", { token: d.token, body: { accept: true } })).json.given).toBe(true);
    expect((await call("/driver/identity", { token: d.token })).json.photoConsent.given).toBe(true);
    expect((await call(`/v1/bookings/${bookingId}`, { token: p.apiKey })).json.driver.photoUrl).toBe(`/v1/bookings/${bookingId}/driver-photo`);
    const ok = await get(p.apiKey);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await ok.arrayBuffer()).equals(Buffer.from(jpeg, "base64"))).toBe(true);
    expect((await get(other.apiKey)).status).toBe(404); // un autre partenaire ne voit rien
    const t = await track();
    expect(t.driver).toMatchObject({ firstName: expect.stringMatching(/^Chauffeur/), plate: expect.any(String), photoUrl: expect.stringContaining("/photo") });
    expect(JSON.stringify(t)).not.toContain(d.phone); // jamais le téléphone du chauffeur
    expect((await trackPhoto()).status).toBe(200);

    // retrait du consentement : la photo disparaît aussitôt
    await call("/driver/identity/photo-consent", { token: d.token, body: { accept: false } });
    expect((await get(p.apiKey)).status).toBe(404);
    expect((await trackPhoto()).status).toBe(404);
    expect((await track()).driver.photoUrl).toBeNull();
    expect((await prisma.auditLog.findMany({ where: { entity: "Driver", entityId: d.id, action: { startsWith: "photo." } } })).map((a) => a.action).sort()).toEqual(["photo.consent", "photo.consent_withdrawn"]);

    // course terminée : plus de chauffeur ni de photo sur la page de suivi
    await call("/driver/identity/photo-consent", { token: d.token, body: { accept: true } });
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "COMPLETED" } });
    expect((await get(p.apiKey)).status).toBe(404);
    expect((await track()).driver).toBeNull();
    // jeton inconnu ou mal formé
    expect((await fetch(`${base}/track/${"x".repeat(32)}`)).status).toBe(404);
    expect((await fetch(`${base}/track/abc`)).status).toBe(404);
  });

  it("le lien de suivi part par SMS et par e-mail à la confirmation, une seule fois, sauf clé de test ou partenaire qui s'en charge", async () => {
    process.env.TRACKING_NOTIFY_SANDBOX = "1";
    const sms = app.get(SmsService), mail = app.get(EmailService);
    const oldSms = sms.provider, oldMail = mail.provider;
    const sent: { sms: any[]; mail: any[] } = { sms: [], mail: [] };
    sms.provider = { send: async (to, text) => { sent.sms.push({ to, text }); } };
    mail.provider = { send: async (m) => { sent.mail.push(m); } };
    const waitFor = async (f: () => boolean) => { for (let i = 0; i < 40 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); };
    const pass = { firstName: "Ana", lastName: "Silva", phone: "+351900000000", email: "ana@exemple.fr", language: "fr" };
    try {
      const p = await mkPartner(false);
      const { res } = await mkBooking(p, {}, "trk-1", { passenger: pass });
      await waitFor(() => sent.sms.length > 0 && sent.mail.length > 0);
      expect(sent.sms).toHaveLength(1);
      expect(sent.sms[0].to).toBe("+351900000000");
      expect(sent.sms[0].text).toContain(res.json.trackingUrl);
      expect(sent.mail).toHaveLength(1);
      expect(sent.mail[0]).toMatchObject({ to: "ana@exemple.fr" });
      expect(sent.mail[0].text).toContain(res.json.trackingUrl);
      // La date d'envoi est écrite APRÈS l'envoi (tâche de fond) : l'attendre au lieu de la lire tout de suite (échec intermittent en CI).
      let sentAt: Date | null = null;
      for (let i = 0; i < 40 && !sentAt; i++) { sentAt = (await prisma.booking.findUniqueOrThrow({ where: { id: res.json.id } })).trackingSentAt; if (!sentAt) await new Promise((r) => setTimeout(r, 50)); }
      expect(sentAt).not.toBeNull();
      // rejeu idempotent de la même réservation : pas de second envoi
      await mkBooking(p, {}, "trk-1", { passenger: pass });
      await new Promise((r) => setTimeout(r, 200));
      expect(sent.sms).toHaveLength(1);

      // un échec du SMS n'empêche ni l'e-mail ni la réservation
      sms.provider = { send: async () => { throw new Error("panne SMS"); } };
      const b2 = await mkBooking(p, {}, "trk-2", { passenger: pass });
      expect(b2.res.status).toBe(201);
      await waitFor(() => sent.mail.length > 1);
      expect(sent.mail).toHaveLength(2);

      // sans e-mail : SMS seul
      sms.provider = { send: async (to, text) => { sent.sms.push({ to, text }); } };
      await mkBooking(p, {}, "trk-3", { passenger: { ...pass, email: undefined } });
      await waitFor(() => sent.sms.length > 1);
      expect(sent.sms).toHaveLength(2);
      expect(sent.mail).toHaveLength(2);

      // partenaire qui envoie lui-même le lien : rien ne part
      await prisma.partner.update({ where: { id: p.partnerId }, data: { notifyPassenger: false } });
      await mkBooking(p, {}, "trk-4", { passenger: pass });
      await new Promise((r) => setTimeout(r, 200));
      expect(sent.sms).toHaveLength(2);

      // clé de test : rien ne part sans TRACKING_NOTIFY_SANDBOX
      await prisma.partner.update({ where: { id: p.partnerId }, data: { notifyPassenger: true } });
      delete process.env.TRACKING_NOTIFY_SANDBOX;
      await mkBooking(p, {}, "trk-5", { passenger: pass });
      await new Promise((r) => setTimeout(r, 200));
      expect(sent.sms).toHaveLength(2);
    } finally {
      sms.provider = oldSms; mail.provider = oldMail; delete process.env.TRACKING_NOTIFY_SANDBOX;
    }
  });

  it("retente seulement le canal de suivi en échec et permet au back-office de le relancer", async () => {
    process.env.TRACKING_NOTIFY_SANDBOX = "1";
    const sms = app.get(SmsService), mail = app.get(EmailService);
    const oldSms = sms.provider, oldMail = mail.provider;
    let smsAttempts = 0, emails = 0;
    try {
      sms.provider = { send: async () => { smsAttempts++; throw new Error("panne SMS"); } };
      mail.provider = { send: async () => { emails++; } };
      const p = await mkPartner(false);
      const { res } = await mkBooking(p, {}, "trk-retry", {
        passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000", email: "ana@exemple.fr", language: "fr" },
      });
      const ride = await prisma.ride.findFirstOrThrow({ where: { bookingId: res.json.id } });
      const smsKey = { rideId_channel: { rideId: ride.id, channel: "SMS" as const } };
      const deliveries = () => prisma.trackingDelivery.findMany({ where: { rideId: ride.id } });
      await expect.poll(async () => (await deliveries()).map(({ channel, status, attempts }) => ({ channel, status, attempts })))
        .toEqual(expect.arrayContaining([
          { channel: "SMS", status: "PENDING", attempts: 1 },
          { channel: "EMAIL", status: "DELIVERED", attempts: 1 },
        ]));

      const notifications = app.get(NotificationsService);
      await prisma.trackingDelivery.update({ where: smsKey, data: { attempts: 7, nextAttemptAt: new Date(0) } });
      await Promise.all([notifications.deliverTrackingLinks(), notifications.deliverTrackingLinks()]);
      expect(smsAttempts).toBe(2);
      expect((await prisma.trackingDelivery.findUniqueOrThrow({ where: smsKey })).status).toBe("FAILED");

      sms.provider = { send: async () => { smsAttempts++; } };
      const path = `/admin/rides/${ride.id}/tracking/retry`;
      expect((await call(path, { body: {} })).status).toBe(401);
      expect((await call(path, { admin: true, body: {} })).json).toEqual({ queued: 1 });
      expect((await call(path, { admin: true, body: {} })).json).toEqual({ queued: 0 });
      await notifications.deliverTrackingLinks();
      expect(smsAttempts).toBe(3);
      expect(emails).toBe(1);
      expect((await deliveries()).every(({ status }) => status === "DELIVERED")).toBe(true);
    } finally {
      sms.provider = oldSms; mail.provider = oldMail; delete process.env.TRACKING_NOTIFY_SANDBOX;
    }
  });

  it("alertes SMS au voyageur : chauffeur arrivé (une fois) et retard de vol (seuil, aggravation, plafond), seulement si le lien de suivi lui a été envoyé", async () => {
    process.env.TRACKING_NOTIFY_SANDBOX = "1";
    const sms = app.get(SmsService), old = sms.provider;
    const sent: { to: string; text: string }[] = [];
    sms.provider = { send: async (to, text) => { sent.push({ to, text }); } };
    const waitFor = async (f: () => boolean) => { for (let i = 0; i < 40 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); };
    const quiet = () => new Promise((r) => setTimeout(r, 200));
    try {
      const d = await mkDriver();
      const p = await mkPartner(false);
      const { ride } = await assigned(d, p);
      await waitFor(() => sent.length === 1); // lien de suivi
      const flights = app.get(FlightsService);
      const delayTo = (min: number) => flights.update(ride.id, { estimatedArrivalAt: new Date(ride.pickupAt.getTime() - ride.flightBufferMin * 60_000 + min * 60_000) }, "test");
      const before = sent.length;

      await delayTo(10); await quiet(); // sous le seuil de 15 min : rien
      expect(sent).toHaveLength(before);
      await delayTo(30); await waitFor(() => sent.length === before + 1);
      expect(sent[before].text).toMatch(/delayed by 30 min/);
      await delayTo(35); await quiet(); // aggravation de 5 min seulement : rien
      expect(sent).toHaveLength(before + 1);
      await delayTo(60); await waitFor(() => sent.length === before + 2);
      expect(sent[before + 1].text).toMatch(/delayed by 60 min/);
      await delayTo(90); await waitFor(() => sent.length === before + 3);
      await delayTo(150); await quiet(); // plafond de 3 alertes de retard par course
      expect(sent).toHaveLength(before + 3);
      expect(sent.every((m) => m.to === "+351900000000")).toBe(true);

      // chauffeur arrivé : une seule alerte, avec prénom, véhicule et plaque
      await call(`/driver/rides/${ride.id}/en-route`, { token: d.token, body: {} });
      await call(`/driver/rides/${ride.id}/arrived`, { token: d.token, body: {} });
      await waitFor(() => sent.length === before + 4);
      expect(sent[before + 3].text).toMatch(/Chauffeur\w*, your driver, has arrived.*Toyota Camry/);
      expect(sent[before + 3].text).toContain("/suivi/");
      await delayTo(240); await quiet(); // chauffeur déjà sur place : plus d'alerte de retard
      expect(sent).toHaveLength(before + 4);
      const arrivedAgain = await prisma.rideEvent.count({ where: { rideId: ride.id, type: "passenger.alert" } });
      expect(arrivedAgain).toBe(4);

      // pas de lien envoyé (partenaire qui s'en charge) : aucune alerte
      await prisma.partner.update({ where: { id: p.partnerId }, data: { notifyPassenger: false } });
      const d2 = await mkDriver();
      const { ride: r2 } = await assigned(d2, p);
      await quiet();
      const n = sent.length;
      await flights.update(r2.id, { estimatedArrivalAt: new Date(r2.pickupAt.getTime() + 45 * 60_000) }, "test");
      await call(`/driver/rides/${r2.id}/en-route`, { token: d2.token, body: {} });
      await call(`/driver/rides/${r2.id}/arrived`, { token: d2.token, body: {} });
      await quiet();
      expect(sent).toHaveLength(n);
    } finally {
      sms.provider = old; delete process.env.TRACKING_NOTIFY_SANDBOX;
    }
  });

  it("les liens de suivi publics sont limités par adresse IP", async () => {
    const unknown = `${base}/track/${"a".repeat(32)}`;
    expect((await fetch(unknown)).status).toBe(404); // limite très haute dans les tests : passe
    process.env.TRACK_IP_PER_MIN = "1";
    try {
      const r = await fetch(unknown);
      expect(r.status).toBe(429);
      expect((await r.json()).message).toMatch(/Trop de requêtes/);
    } finally { process.env.TRACK_IP_PER_MIN = "100000"; }
  });

  it("un selfie qui ne correspond pas à la référence suspend le compte (prêt de compte) ; refuse un fichier qui n'est pas une image", async () => {
    const d = await mkDriver();
    on();
    await call("/driver/availability", { token: d.token, body: { availability: "SUSPENDED" } });
    expect((await call("/driver/identity/selfie", { token: d.token, body: { image: Buffer.alloc(300, 1).toString("base64") } })).status).toBe(422);
    await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } });
    const ref = (await call("/admin/identity-checks?status=PENDING", { admin: true })).json[0];
    await call(`/admin/identity-checks/${ref.id}/review`, { admin: true, body: { decision: "APPROVE" } });
    await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } });
    const shift = (await call("/admin/identity-checks", { admin: true })).json.find((x: any) => x.kind === "SHIFT");
    expect(shift.reference).toMatch(/^data:image/); // l'équipe compare avec la référence
    await call(`/admin/identity-checks/${shift.id}/review`, { admin: true, body: { decision: "REJECT", reason: "Visage différent" } });
    const after = await prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe("SUSPENDED");
    expect(after.identityVerifiedAt).toBeNull();
    expect((await prisma.notification.findMany({ where: { driverId: d.id } })).map((n) => n.type)).toContain("IDENTITY_REJECTED");
  });

  it("les selfies de prise de service sont purgés après 30 jours, pas la référence", async () => {
    const d = await mkDriver();
    on();
    const mk = (kind: "REFERENCE" | "SHIFT", days: number) => prisma.identityCheck.create({ data: { driverId: d.id, kind, status: "VALID", mime: "image/jpeg", image: Buffer.from("x"), createdAt: new Date(Date.now() - days * 86400_000) } });
    await mk("REFERENCE", 90); await mk("SHIFT", 45); await mk("SHIFT", 2);
    await app.get(IdentityService).sweep();
    const left = await prisma.identityCheck.findMany({ where: { driverId: d.id } });
    expect(left.map((x) => x.kind).sort()).toEqual(["REFERENCE", "SHIFT"]);
  });
});

describe("vérifications d'identité aléatoires en cours de service", () => {
  afterEach(() => { process.env.IDENTITY_CHECKS = "0"; });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString("base64");
  /** Chauffeur en ligne, référence validée, dernier selfie vieux de 3 h. Le contrôle est activé APRÈS sa création. */
  async function onDutyDriver(enable = true) {
    const d = await mkDriver();
    await prisma.identityCheck.create({ data: { driverId: d.id, kind: "REFERENCE", status: "VALID", mime: "image/jpeg", image: Buffer.from("ref") } });
    await prisma.driver.update({ where: { id: d.id }, data: { identityVerifiedAt: new Date(Date.now() - 3 * 3600_000) } });
    if (enable) process.env.IDENTITY_CHECKS = "1";
    return d;
  }
  const svc = () => app.get(IdentityService);

  it("le tirage sollicite un chauffeur en service, une seule fois, et sa réponse valide la vérification", async () => {
    const d = await onDutyDriver();
    expect(await svc().spotSweep(new Date(), () => 0.999)).toBe(0); // tirage défavorable : personne
    expect(await svc().spotSweep(new Date(), () => 0)).toBe(1);
    expect(await svc().spotSweep(new Date(), () => 0)).toBe(0); // déjà une demande ouverte
    const st = (await call("/driver/identity", { token: d.token })).json.selfie;
    expect(st.spotCheck.id).toBeTruthy();
    expect(st.spotCheck.deferred).toBe(false);
    expect((await prisma.notification.findMany({ where: { driverId: d.id } })).map((n) => n.type)).toContain("IDENTITY_SPOT");

    expect((await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } })).json).toMatchObject({ kind: "SPOT", status: "VALID" });
    expect((await call("/driver/identity", { token: d.token })).json.selfie.spotCheck).toBeNull();
    const row = await prisma.identityCheck.findFirstOrThrow({ where: { kind: "SPOT" } });
    expect(row.status).toBe("VALID");
    expect(row.image).not.toBeNull();
    expect(row.requestedBy).toBe("system");
    // l'écart minimal avec le dernier selfie évite une nouvelle sollicitation immédiate
    expect(await svc().spotSweep(new Date(), () => 0)).toBe(0);
  });

  it("jamais pour un chauffeur hors service, ni pendant une course en cours", async () => {
    const p = await mkPartner();
    const off = await onDutyDriver(false);
    await prisma.driver.update({ where: { id: off.id }, data: { availability: "SUSPENDED" } });
    const busy = await onDutyDriver(false);
    const { ride } = await assigned(busy, p);
    process.env.IDENTITY_CHECKS = "1";
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "IN_PROGRESS" } });
    expect(await svc().spotSweep(new Date(), () => 0)).toBe(0);
    // et une demande ouverte avant le départ de la course est suspendue, pas pénalisée
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "ASSIGNED" } });
    expect(await svc().spotSweep(new Date(), () => 0)).toBe(1); // en mission assignée : sollicité
    await prisma.ride.update({ where: { id: ride.id }, data: { status: "IN_PROGRESS" } });
    expect((await call("/driver/identity", { token: busy.token })).json.selfie.spotCheck.deferred).toBe(true);
    await svc().expireSpots(new Date(Date.now() + 3600_000));
    const open = await prisma.identityCheck.findFirstOrThrow({ where: { driverId: busy.id, kind: "SPOT" } });
    expect(open.status).toBe("REQUESTED"); // reportée
    expect(open.dueAt!.getTime()).toBeGreaterThan(Date.now() + 3600_000);
  });

  it("sans réponse à l'échéance : vérification manquée, chauffeur hors ligne, comptage visible de l'équipe", async () => {
    const d = await onDutyDriver();
    await svc().spotSweep(new Date(), () => 0);
    await svc().expireSpots(new Date()); // avant l'échéance : rien
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).availability).toBe("AVAILABLE");
    await svc().expireSpots(new Date(Date.now() + 11 * 60_000));
    const after = await prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.availability).toBe("SUSPENDED");
    expect(after.identityVerifiedAt).toBeNull();
    expect((await prisma.identityCheck.findFirstOrThrow({ where: { kind: "SPOT" } })).status).toBe("MISSED");
    expect((await call("/admin/identity-checks", { admin: true })).json[0]).toMatchObject({ status: "MISSED", missedLast30Days: 1 });
    expect((await prisma.notification.findMany({ where: { driverId: d.id } })).map((n) => n.type)).toContain("IDENTITY_MISSED");
    // le chauffeur reprend un selfie normal pour se remettre en ligne
    expect((await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } })).json.kind).toBe("SHIFT");
  });

  it("l'équipe peut demander une vérification immédiate ; un visage différent suspend le compte", async () => {
    const d = await onDutyDriver();
    const r = await call(`/admin/drivers/${d.id}/identity-spot`, { admin: true, body: {} });
    expect(r.status).toBe(201);
    expect((await call(`/admin/drivers/${d.id}/identity-spot`, { admin: true, body: {} })).status).toBe(409);
    await call("/driver/identity/selfie", { token: d.token, body: { image: jpeg } });
    const spot = (await call("/admin/identity-checks", { admin: true })).json.find((x: any) => x.kind === "SPOT");
    expect(spot.reference).toMatch(/^data:image/);
    await call(`/admin/identity-checks/${spot.id}/review`, { admin: true, body: { decision: "REJECT", reason: "Visage différent" } });
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("SUSPENDED");
  });

  it("désactivable, et la probabilité par passage reste faible", async () => {
    await onDutyDriver();
    process.env.IDENTITY_SPOT = "0";
    expect(await svc().spotSweep(new Date(), () => 0)).toBe(0);
    delete process.env.IDENTITY_SPOT;
    // moyenne de 240 min, passage toutes les 5 s : ~0,03 % par passage
    const p = 1 - Math.exp(-5 / (240 * 60));
    expect(p).toBeLessThan(0.001);
  });
});

describe("suivi du vol : retard, avance, atterri, annulé", () => {
  async function rideWithFlight() {
    const p = await mkPartner();
    const d = await mkDriver();
    const { ride } = await assigned(d, p);
    const landing = ride.pickupAt.getTime() - ride.flightBufferMin * 60_000;
    return { p, d, ride, landing, flights: app.get(FlightsService) };
  }
  const types = async (id: string) => (await prisma.notification.findMany({ where: { driverId: id }, orderBy: { createdAt: "asc" } })).map((n) => n.type);

  it("vol en avance : statut, notification, webhook ; la prise en charge convenue ne bouge pas ; petite avance ignorée", async () => {
    const { p, d, ride, landing, flights } = await rideWithFlight();
    await flights.update(ride.id, { estimatedArrivalAt: new Date(landing - 5 * 60_000) }, "test"); // 5 min : négligeable
    expect(await types(d.id)).not.toContain("FLIGHT_EARLY");
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).flightStatus).not.toBe("EARLY");

    const r = await flights.update(ride.id, { estimatedArrivalAt: new Date(landing - 25 * 60_000) }, "test");
    expect(r).toMatchObject({ changed: true, status: "EARLY", earlyMin: 25, delayMin: 0 });
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.flightStatus).toBe("EARLY");
    expect(after.flightEarlyMin).toBe(25);
    expect(after.flightDelayMin).toBe(0);
    const n = (await prisma.notification.findMany({ where: { driverId: d.id, type: "FLIGHT_EARLY" } }))[0];
    expect(n.title).toContain("en avance (−25 min)");
    expect(n.body).toContain("reste"); // l'heure convenue reste la même
    const view = await call("/driver/rides", { token: d.token });
    expect(view.json[0].flight).toMatchObject({ status: "EARLY", earlyMin: 25 });
    expect(view.json[0].effectivePickupAt).toBe(ride.pickupAt.toISOString());
    expect(await prisma.webhookDelivery.count({ where: { eventType: "flight.updated" } })).toBeGreaterThanOrEqual(1);
    void p;
  });

  it("retard, retour à l'heure, atterrissage : un message à chaque changement, et un vol posé le reste", async () => {
    const { d, ride, landing, flights } = await rideWithFlight();
    await flights.update(ride.id, { estimatedArrivalAt: new Date(landing + 40 * 60_000) }, "test");
    await flights.update(ride.id, { estimatedArrivalAt: null }, "test");
    await flights.update(ride.id, { estimatedArrivalAt: new Date(landing + 2 * 60_000), status: "LANDED" }, "test");
    expect(await types(d.id)).toEqual(expect.arrayContaining(["FLIGHT_UPDATE", "FLIGHT_LANDED"]));
    const landed = (await prisma.notification.findMany({ where: { driverId: d.id, type: "FLIGHT_LANDED" } }))[0];
    expect(landed.title).toBe(`Vol AF1234 atterri`);
    // une estimation tardive du fournisseur ne remet pas un vol posé « en retard »
    await flights.update(ride.id, { estimatedArrivalAt: new Date(landing + 90 * 60_000) }, "test");
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).flightStatus).toBe("LANDED");
  });

  it("vol annulé : le chauffeur est prévenu (message + e-mail), l'équipe alertée, la mission n'est PAS annulée automatiquement", async () => {
    const { p, d, ride, flights } = await rideWithFlight();
    const r = await flights.update(ride.id, { status: "CANCELLED" }, "test");
    expect(r.status).toBe("CANCELLED");
    const n = (await prisma.notification.findMany({ where: { driverId: d.id, type: "FLIGHT_CANCELLED" } }))[0];
    expect(n.title).toBe("Vol AF1234 annulé");
    expect(n.body).toContain("Ne vous déplacez pas");
    expect(await prisma.rideEvent.count({ where: { rideId: ride.id, type: "flight.cancelled" } })).toBe(1);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe("ASSIGNED"); // décision commerciale : humaine
    const alerts = (await call("/admin/alerts", { admin: true })).json;
    expect(alerts.find((a: any) => a.rideId === ride.id)).toMatchObject({ reason: "FLIGHT_CANCELLED", flight: "AF1234" });
    // le partenaire voit le statut dans la réservation
    const b = await prisma.booking.findFirstOrThrow({});
    expect((await call(`/v1/bookings/${b.id}`, { token: p.apiKey })).json.flight.status).toBe("CANCELLED");
    // idempotent : une seconde annulation ne renotifie pas
    expect((await flights.update(ride.id, { status: "CANCELLED" }, "test")).changed).toBe(false);
  });
});

describe("rappels d'échéances des documents", () => {
  const svc = () => app.get(DeadlinesService);
  async function setExpiry(driverId: string, type: string, days: number, status: "APPROVED" | "PENDING" = "APPROVED") {
    await prisma.document.deleteMany({ where: { driverId, type: type as any } });
    return prisma.document.create({ data: { driverId, type: type as any, storageKey: "k", status, expiresAt: new Date(Date.now() + days * 86400_000 - 3600_000) } });
  }
  const types = async (id: string) => (await prisma.notification.findMany({ where: { driverId: id } })).map((n) => n.type);

  it("un rappel par palier, une seule fois, avec e-mail à partir de 7 jours", async () => {
    const d = await mkDriver();
    const ins = await setExpiry(d.id, "INSURANCE", 25);
    expect((await svc().sweep(new Date(), true)).reminded).toBe(1);
    expect((await svc().sweep(new Date(), true)).reminded).toBe(0); // déjà envoyé pour ce palier
    expect((await prisma.notification.findMany({ where: { driverId: d.id, type: "DOC_EXPIRING" } }))[0].title).toContain("Assurance");
    // le temps passe : palier de 7 jours, nouveau rappel
    expect((await svc().sweep(new Date(Date.now() + 19 * 86400_000), true)).reminded).toBe(1);
    expect(await prisma.documentReminder.count({ where: { documentId: ins.id } })).toBe(2);
    // loin de l'échéance : rien
    const e = await mkDriver();
    await setExpiry(e.id, "INSURANCE", 120);
    expect((await svc().sweep(new Date(), true)).reminded).toBe(0);
  });

  it("un document remplacé par un plus récent ne déclenche plus de rappel ; en attente de validation : ignoré", async () => {
    const d = await mkDriver();
    const old = await setExpiry(d.id, "TECHNICAL_INSPECTION", 5);
    await prisma.document.create({ data: { driverId: d.id, type: "TECHNICAL_INSPECTION", storageKey: "k2", status: "APPROVED", expiresAt: new Date(Date.now() + 360 * 86400_000) } });
    expect((await svc().sweep(new Date(), true)).reminded).toBe(0);
    expect(await prisma.documentReminder.count({ where: { documentId: old.id } })).toBe(0);
    const e = await mkDriver();
    await setExpiry(e.id, "TECHNICAL_INSPECTION", 5, "PENDING");
    expect((await svc().sweep(new Date(), true)).reminded).toBe(0);
  });

  it("document obligatoire expiré : hors ligne, mise en ligne refusée jusqu'au renouvellement ; jamais pendant une mission", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const busy = await mkDriver();
    const { ride } = await assigned(busy, p);
    void ride;
    await setExpiry(d.id, "INSURANCE", -2);
    await setExpiry(busy.id, "INSURANCE", -2);
    const r = await svc().sweep(new Date(), true);
    expect(r.offline).toBe(1); // d est mis hors ligne ; busy a une mission : on n'interrompt pas
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).availability).toBe("SUSPENDED");
    expect(await types(d.id)).toContain("DOC_EXPIRED");
    const blocked = await call("/driver/availability", { token: d.token, body: { availability: "AVAILABLE" } });
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe("DOCUMENTS_EXPIRED");
    await setExpiry(d.id, "INSURANCE", 300); // renouvelé et validé
    expect((await call("/driver/availability", { token: d.token, body: { availability: "AVAILABLE" } })).status).toBe(201);
  });

  it("tableau des échéances du chauffeur, trié du plus urgent ; liste de l'équipe", async () => {
    const d = await mkDriver();
    await setExpiry(d.id, "VTC_CARD", 400);
    await setExpiry(d.id, "DRIVING_LICENSE", 12);
    const list = (await call("/driver/deadlines", { token: d.token })).json;
    expect(list[0]).toMatchObject({ type: "DRIVING_LICENSE", status: "SOON", daysLeft: 12, label: "Permis de conduire" });
    expect(list.find((x: any) => x.type === "VTC_CARD").status).toBe("OK");
    expect(list.every((x: any) => x.label)).toBe(true);
    const adm = (await call("/admin/expiring?days=30", { admin: true })).json;
    expect(adm.find((x: any) => x.driverId === d.id)).toMatchObject({ type: "DRIVING_LICENSE", daysLeft: 12 });
  });
});

describe("revenus du chauffeur", () => {
  const range = () => `from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86400_000).toISOString())}`;
  async function completedRide(d: { id: string; token: string }, p: { apiKey: string }) {
    const { ride } = await assigned(d, p);
    for (const a of ["en-route", "arrived", "start", "complete"]) expect((await call(`/driver/rides/${ride.id}/${a}`, { token: d.token, body: {} })).status).toBe(201);
    return ride;
  }

  it("courses terminées, indemnité, pénalité, net, net par heure de mission, avenir", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const done = await completedRide(d, p);
    const e1 = (await call(`/driver/earnings?${range()}`, { token: d.token })).json;
    expect(e1.period).toBe("custom");
    expect(e1.totals.rides).toBe(1);
    expect(e1.totals.ridesCents).toBe(done.driverNetCents);
    expect(e1.totals.netCents).toBe(done.driverNetCents);
    expect(e1.totals.missionHours).toBeGreaterThanOrEqual(0); // mise en route et fin quasi simultanées dans le test
    expect(e1.rides[0]).toMatchObject({ ref: done.ref, netCents: done.driverNetCents });
    expect(e1.days).toHaveLength(1);

    // une pénalité vient en déduction, une indemnité d'annulation s'ajoute
    await prisma.driverPenalty.create({ data: { driverId: d.id, rideId: done.id, kind: "GIVE_BACK", amountCents: 1000, minutesBefore: 60 * 72 } });
    const e2 = (await call(`/driver/earnings?${range()}`, { token: d.token })).json;
    expect(e2.totals.penaltyCents).toBe(1000);
    expect(e2.totals.netCents).toBe(done.driverNetCents - 1000);
    const comp = await prisma.ride.create({ data: {
      bookingId: (await prisma.booking.findFirstOrThrow({})).id, status: "CANCELLED_BY_PARTNER", pickupAt: new Date(Date.now() + 86400_000), pickupAddress: "A", dropoffAddress: "B",
      pickupLat: 48.8, pickupLng: 2.3, dropoffLat: 48.9, dropoffLng: 2.4, distanceKm: 10, durationMin: 20, category: "BERLINE", priceCents: 5000, commissionCents: 1000, driverNetCents: 4000,
      driverId: d.id, cancelledAt: new Date(), driverCompensationCents: 2200,
    } as any });
    void comp;
    const e3 = (await call(`/driver/earnings?${range()}`, { token: d.token })).json;
    expect(e3.totals.compensationCents).toBe(2200);
    expect(e3.totals.netCents).toBe(done.driverNetCents + 2200 - 1000);
  });

  it("un chauffeur ne voit que ses revenus ; périodes nommées ; intervalle invalide refusé ; export CSV", async () => {
    const p = await mkPartner();
    const a = await mkDriver(), b = await mkDriver();
    await completedRide(a, p);
    expect((await call(`/driver/earnings?${range()}`, { token: b.token })).json.totals.rides).toBe(0);
    for (const per of ["day", "week", "fortnight", "month"]) expect((await call(`/driver/earnings?period=${per}`, { token: a.token })).status).toBe(200);
    expect((await call("/driver/earnings?period=semester", { token: a.token })).status).toBe(422);
    expect((await call("/driver/earnings?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z", { token: a.token })).status).toBe(422); // > 92 jours
    const res = await fetch(`${base}/driver/earnings/csv?${range()}`, { headers: { authorization: `Bearer ${a.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("mes-revenus.csv");
    const csv = await res.text();
    expect(csv).toContain("type;date;reference;detail;montant_eur");
    expect(csv).toContain("COURSE;");
    expect(csv).toContain("TOTAL;");
  });

  it("le prix client et la commission n'apparaissent que si le réglage le permet", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    await completedRide(d, p);
    expect((await call(`/driver/earnings?${range()}`, { token: d.token })).json.rides[0].clientCents).toBeGreaterThan(0);
    process.env.DRIVER_SEES_CLIENT_PRICE = "0";
    const hidden = (await call(`/driver/earnings?${range()}`, { token: d.token })).json;
    delete process.env.DRIVER_SEES_CLIENT_PRICE;
    expect(hidden.rides[0].clientCents).toBeNull();
    expect(hidden.rides[0].commissionCents).toBeNull();
  });
});

describe("signalement d'incident", () => {
  it("enregistre avec position et heure, urgent par défaut pour un danger, confirme au chauffeur avec les numéros d'urgence", async () => {
    const d = await mkDriver({ lat: 48.85, lng: 2.35 });
    const r = await call("/driver/incidents", { token: d.token, body: { kind: "DANGER", message: "Client menaçant" } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ urgent: true, status: "OPEN", located: true });
    const row = await prisma.incident.findFirstOrThrow({});
    expect(row.lat).toBeCloseTo(48.85);
    expect(row.message).toBe("Client menaçant");
    const n = (await prisma.notification.findMany({ where: { driverId: d.id, type: "INCIDENT_RECEIVED" } }))[0];
    expect(n.title).toBe("Alerte reçue");
    expect(n.body).toContain("112");
    expect(n.body).toContain("ne remplace pas les secours");
    // une panne n'est pas urgente par défaut et propose un sauveteur ; le chauffeur peut forcer l'urgence
    expect((await call("/driver/incidents", { token: d.token, body: { kind: "BREAKDOWN" } })).json.urgent).toBe(false);
    expect((await call("/driver/incidents", { token: d.token, body: { kind: "CLIENT", urgent: true } })).json.urgent).toBe(true);
    expect((await prisma.notification.findMany({ where: { driverId: d.id, type: "INCIDENT_RECEIVED" } })).some((x) => x.body.includes("sauveteur"))).toBe(true);
  });

  it("lié à une mission : trace dans les événements ; mission d'un autre refusée ; limite horaire", async () => {
    const p = await mkPartner();
    const d = await mkDriver(), other = await mkDriver();
    const { ride } = await assigned(d, p);
    expect((await call("/driver/incidents", { token: other.token, body: { kind: "OTHER", rideId: ride.id } })).status).toBe(404);
    expect((await call("/driver/incidents", { token: d.token, body: { kind: "PAYMENT", rideId: ride.id } })).status).toBe(201);
    expect(await prisma.rideEvent.count({ where: { rideId: ride.id, type: "driver.incident" } })).toBe(1);
    for (let i = 0; i < 4; i++) await call("/driver/incidents", { token: d.token, body: { kind: "OTHER" } });
    expect((await call("/driver/incidents", { token: d.token, body: { kind: "OTHER" } })).status).toBe(429);
    expect((await call("/driver/incidents", { token: other.token, body: { kind: "NOPE" } })).status).toBe(422);
  });

  it("l'équipe voit les urgences d'abord avec téléphone et carte, accuse réception puis clôt ; le chauffeur est prévenu", async () => {
    const d = await mkDriver({ lat: 48.85, lng: 2.35 });
    await call("/driver/incidents", { token: d.token, body: { kind: "OTHER", message: "Question" } });
    await call("/driver/incidents", { token: d.token, body: { kind: "ACCIDENT" } });
    const list = (await call("/admin/incidents", { admin: true })).json;
    expect(list[0]).toMatchObject({ kind: "ACCIDENT", urgent: true, driver: expect.stringContaining("Chauffeur"), phone: d.phone });
    expect(list[0].map).toContain("google.com/maps?q=48.85");
    const id = list[0].id;
    expect((await call(`/admin/incidents/${id}/ack`, { admin: true, body: {} })).status).toBe(201);
    expect((await call(`/admin/incidents/${id}/ack`, { admin: true, body: {} })).status).toBe(404); // déjà pris en charge
    expect((await call(`/admin/incidents/${id}/close`, { admin: true, body: { resolution: "x" } })).status).toBe(422); // motif trop court
    expect((await call(`/admin/incidents/${id}/close`, { admin: true, body: { resolution: "Dépanneuse envoyée" } })).status).toBe(201);
    const types = (await prisma.notification.findMany({ where: { driverId: d.id } })).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(["INCIDENT_ACK", "INCIDENT_CLOSED"]));
    expect((await call("/driver/incidents", { token: d.token })).json.find((x: any) => x.id === id)).toMatchObject({ status: "CLOSED", resolution: "Dépanneuse envoyée" });
  });
});
