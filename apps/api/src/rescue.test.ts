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
    'TRUNCATE "IdentityCheck","DriverPenalty","RescueRequest","Notification","OtpCode","AdminUser","WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE',
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
    expect((await call(`/admin/rides/${ride.id}/assign`, { admin: true, body: { driverId: d.id } })).status).toBe(409);
    expect((await call(`/admin/rides/${ride.id}/assign`, { admin: true, body: { driverId: requester.id } })).status).toBe(201);
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
    await call("/driver/identity", { token: d.token, body: { businessName: "Benali Transport", siret: "12345678901234", revtcNumber: "EVTC-075-0001" } });
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
