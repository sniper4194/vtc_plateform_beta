import { manualAssignment } from "../test/manual-assignment";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { BookingsService, cancellationFeeCents } from "./bookings.service";
import { DISPATCH, DispatchService } from "./dispatch.service";
import { generateApiKey, signWebhook } from "./security";
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

describe("santé", () => {
  it("liveness et readiness (base joignable)", async () => {
    expect((await call("/health")).json).toEqual({ status: "ok" });
    expect((await call("/ready")).json).toEqual({ status: "ok", db: true });
  });
});

describe("authentification", () => {
  it("refuse une clé API absente ou inconnue", async () => {
    expect((await call("/v1/quotes", { body: {} })).status).toBe(401);
    expect((await call("/v1/quotes", { token: "vtc_test_nope", body: {} })).status).toBe(401);
  });
  it("refuse l'admin sans token et le chauffeur sans JWT", async () => {
    expect((await call("/admin/rides")).status).toBe(401);
    expect((await call("/driver/me")).status).toBe(401);
    expect((await call("/driver/me", { token: "a.b" })).status).toBe(401);
  });
  it("refuse un mauvais code OTP", async () => {
    const d = await mkDriver();
    expect((await call("/driver/login", { body: { phone: d.phone, code: "999999" } })).status).toBe(401);
  });
});

describe("devis", () => {
  it("applique le forfait aéroport et valide les entrées", async () => {
    const p = await mkPartner();
    const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 2 } });
    expect(q.json.total).toBe(55);
    expect(q.json.flatRate).toBe(true);
    const bad = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(-1), category: "BERLINE", passengers: 2 } });
    expect(bad.status).toBe(422);
  });
  it("retombe sur le forfait « Paris » quand l'adresse est aussi dans une zone gare sans forfait", async () => {
    const p = await mkPartner();
    const nearGareNord = { address: "175 rue du Faubourg Saint-Denis, Paris", lat: 48.8766, lng: 2.3571 };
    const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: nearGareNord, pickupAt: inDays(3), category: "BERLINE", passengers: 2 } });
    expect(q.json.total).toBe(55);
    expect(q.json.flatRate).toBe(true);
  });
  it("utilise le routage routier quand il est disponible, et l'indique", async () => {
    const p = await mkPartner();
    const routing = app.get(RoutingService);
    const nearby = { address: "Rue voisine", lat: 48.8700, lng: 2.3400 };
    const body = { pickup: nearby, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 1 };
    const before = await call("/v1/quotes", { token: p.apiKey, body });
    expect(before.json.routing).toBe("estimate");
    routing.provider = { route: async () => ({ distanceKm: 12, durationMin: 40 }) };
    try {
      const after = await call("/v1/quotes", { token: p.apiKey, body });
      expect(after.json).toMatchObject({ routing: "road", distanceKm: 12, durationMin: 40 });
      expect(after.json.total).toBeGreaterThan(before.json.total); // 12 km / 40 min coûtent plus que l'estimation de 2 km
    } finally { routing.provider = null; }
  });

  it("un devis ne sert qu'une fois et appartient à son partenaire", async () => {
    const p = await mkPartner(), other = await mkPartner();
    const { quote } = await mkBooking(p, {}, "k1");
    const body = { quoteId: quote.quoteId, passenger: { firstName: "A", lastName: "B", phone: "123456" } };
    expect((await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": "k2" }, body })).status).toBe(409);
    expect((await call("/v1/bookings", { token: other.apiKey, headers: { "idempotency-key": "k3" }, body })).status).toBe(404);
  });
  it("refuse un devis expiré", async () => {
    const p = await mkPartner();
    const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 1 } });
    await prisma.quote.update({ where: { id: q.json.quoteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": "x" }, body: { quoteId: q.json.quoteId, passenger: { firstName: "A", lastName: "B", phone: "123456" } } });
    expect(r.status).toBe(409);
  });
});

describe("réservation et idempotence", () => {
  it("exige Idempotency-Key et la rend rejouable", async () => {
    const p = await mkPartner();
    const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 1 } });
    const body = { quoteId: q.json.quoteId, passenger: { firstName: "A", lastName: "B", phone: "123456" } };
    expect((await call("/v1/bookings", { token: p.apiKey, body })).status).toBe(400);
    const a = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": "same" }, body });
    const b = await call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": "same" }, body });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.id).toBe(a.json.id);
    expect(await prisma.booking.count()).toBe(1);
  });
  it("deux requêtes simultanées avec la même clé ne créent qu'une réservation", async () => {
    const p = await mkPartner();
    const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 1 } });
    const body = { quoteId: q.json.quoteId, passenger: { firstName: "A", lastName: "B", phone: "123456" } };
    const rs = await Promise.all([1, 2, 3].map(() => call("/v1/bookings", { token: p.apiKey, headers: { "idempotency-key": "race" }, body })));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.json.id)).size).toBe(1);
    expect(await prisma.booking.count()).toBe(1);
  });
});

describe("parcours complet partenaire ↔ chauffeur", () => {
  it("bourse, acceptation exclusive, cycle de vie et webhooks signés", async () => {
    const p = await mkPartner();
    const d1 = await mkDriver({ lat: 49.0, lng: 2.5 }), d2 = await mkDriver();
    const { res } = await mkBooking(p);
    expect(res.status).toBe(201);
    expect(res.json.status).toBe("DISPATCHING");
    expect(res.json.driver).toBeNull();

    // les deux chauffeurs voient l'offre, sans données du passager
    const o1 = await call("/driver/offers", { token: d1.token });
    const o2 = await call("/driver/offers", { token: d2.token });
    expect(o1.json).toHaveLength(1);
    expect(o2.json).toHaveLength(1);
    expect(JSON.stringify(o1.json)).not.toContain("Silva");
    expect(o1.json[0].netCents).toBe(4400); // 55 € − 20 %
    expect(o1.json[0].secondsLeft).toBeGreaterThan(200);
    expect(o1.json[0].pickupDistanceKm).toBeLessThan(5); // d1 est positionné près de CDG
    expect(o2.json[0].pickupDistanceKm).toBeGreaterThan(15); // d2 est à Paris

    // acceptations simultanées : un seul gagnant
    const [a1, a2] = await Promise.all([
      call(`/driver/offers/${o1.json[0].offerId}/accept`, { token: d1.token, body: {} }),
      call(`/driver/offers/${o2.json[0].offerId}/accept`, { token: d2.token, body: {} }),
    ]);
    expect([a1.status, a2.status].sort()).toEqual([201, 409]);
    const winner = a1.status === 201 ? d1 : d2;
    const loser = winner === d1 ? d2 : d1;
    expect((await call("/driver/offers", { token: loser.token })).json).toHaveLength(0);

    // le partenaire voit le chauffeur
    const view = await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey });
    expect(view.json.status).toBe("ASSIGNED");
    expect(view.json.driver.plate).toMatch(/^AA-/);

    // le gagnant voit le passager, le perdant ne peut pas agir sur la course
    const rides = await call("/driver/rides", { token: winner.token });
    expect(rides.json[0].passenger.name).toBe("Ana Silva");
    const rideId = rides.json[0].rideId;
    expect((await call(`/driver/rides/${rideId}/en-route`, { token: loser.token, body: {} })).status).toBe(404);

    // cycle de vie, avec garde-fous
    expect((await call(`/driver/rides/${rideId}/start`, { token: winner.token, body: {} })).status).toBe(409);
    for (const a of ["en-route", "arrived"]) expect((await call(`/driver/rides/${rideId}/${a}`, { token: winner.token, body: {} })).status).toBe(201);
    expect((await call(`/driver/rides/${rideId}/no-show`, { token: winner.token, body: {} })).status).toBe(409); // trop tôt
    for (const a of ["start", "complete"]) expect((await call(`/driver/rides/${rideId}/${a}`, { token: winner.token, body: {} })).status).toBe(201);
    expect((await call(`/driver/rides/${rideId}/complete`, { token: winner.token, body: {} })).status).toBe(409);

    // webhooks : tous livrés, dans l'ordre, signés
    await webhooks.deliverDue();
    const types = received.map((r) => JSON.parse(r.body).type);
    expect(types).toEqual(["booking.confirmed", "driver.assigned", "driver.en_route", "driver.arrived", "ride.started", "ride.completed"]);
    for (const r of received) {
      const m = /t=(\d+),v1=([0-9a-f]+)/.exec(r.headers["x-signature"])!;
      expect(m[2]).toBe(signWebhook(p.webhookSecret!, r.body, Number(m[1])));
    }
    const finalView = await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey });
    expect(finalView.json.status).toBe("COMPLETED");

    // gains de la quinzaine : la course est datée dans 3 jours → comptée seulement si dans la quinzaine
    const home = await call("/driver/home", { token: winner.token });
    expect(home.json.upcomingRides).toBe(0);

    const hist = await call("/driver/rides?scope=history", { token: winner.token });
    expect(hist.json).toHaveLength(1);
  });

  it("un partenaire ne voit pas les réservations des autres", async () => {
    const a = await mkPartner(), b = await mkPartner();
    const { res } = await mkBooking(a);
    expect((await call(`/v1/bookings/${res.json.id}`, { token: b.apiKey })).status).toBe(404);
    expect((await call(`/v1/bookings/${res.json.id}`, { token: b.apiKey, method: "DELETE" })).status).toBe(404);
  });
});

describe("annulation", () => {
  it("annule, retire les offres et notifie le partenaire", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    const c = await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey, method: "DELETE" });
    expect(c.status).toBe(200);
    expect(c.json.cancellationFee).toBe(0); // > 24 h
    expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(0);
    await webhooks.deliverDue();
    expect(received.map((r) => JSON.parse(r.body).type)).toContain("booking.cancelled");
    expect((await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey, method: "DELETE" })).status).toBe(409);
  });
  it("politique de frais provisoire", () => {
    const now = new Date();
    expect(cancellationFeeCents(5500, new Date(now.getTime() + 30 * 3600_000), now)).toBe(0);
    expect(cancellationFeeCents(5500, new Date(now.getTime() + 5 * 3600_000), now)).toBe(2750);
    expect(cancellationFeeCents(5500, new Date(now.getTime() + 1 * 3600_000), now)).toBe(5500);
  });
});

describe("dispatch", () => {
  it("ne propose qu'aux chauffeurs actifs, disponibles, avec la bonne catégorie", async () => {
    const p = await mkPartner();
    const ok = await mkDriver();
    const van = await mkDriver({ category: "VAN" });
    const pending = await mkDriver({ docs: false });
    const suspended = await mkDriver();
    await call("/driver/availability", { token: suspended.token, body: { availability: "SUSPENDED" } });
    await mkBooking(p);
    expect((await call("/driver/offers", { token: ok.token })).json).toHaveLength(1);
    for (const d of [van, pending, suspended]) expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(0);
  });

  it("n'attribue pas deux courses qui se chevauchent au même chauffeur", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const first = await mkBooking(p, { pickupAt: inDays(3) });
    const offer = (await call("/driver/offers", { token: d.token })).json[0];
    expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);
    await mkBooking(p, { pickupAt: new Date(Date.now() + 3 * 86400_000 + 20 * 60_000).toISOString() });
    expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(0);
    expect(first.res.status).toBe(201);
  });

  it("refuse une offre expirée et la remplace au tour suivant", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    await mkBooking(p);
    const offer = (await call("/driver/offers", { token: d.token })).json[0];
    await prisma.dispatchOffer.update({ where: { id: offer.offerId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} })).status).toBe(409);
    // tour suivant (le délai de relance est simulé en avançant l'horloge du sweep)
    await dispatch.sweep(new Date(Date.now() + (DISPATCH.retryDelaySec + 5) * 1000));
    expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(1);
  });

  it("signale la course à l'opérateur après tous les tours, qui peut l'attribuer à la main", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    let clock = Date.now();
    for (let i = 0; i < DISPATCH.maxRounds + 1; i++) {
      clock += 24 * 3600_000; // fait expirer l'offre et dépasse le délai de relance
      await dispatch.sweep(new Date(clock));
    }
    const alerts = await call("/admin/alerts", { admin: true });
    expect(alerts.json).toHaveLength(1);
    expect(alerts.json[0].rideId).toBe(res.json.rideId);
    const ev = await call(`/admin/rides/${res.json.rideId}/events`, { admin: true });
    expect(ev.json.filter((e: any) => e.type === "dispatch.round")).toHaveLength(DISPATCH.maxRounds);
    expect((await call(`/admin/rides/${res.json.rideId}/assign`, await manualAssignment(prisma, res.json.rideId, d.id))).status).toBe(201);
    expect((await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey })).json.status).toBe("ASSIGNED");
    expect((await call("/admin/alerts", { admin: true })).json).toHaveLength(0);
  });

  it("le chauffeur qui annule est exclu, sa fiabilité baisse, la course est redistribuée", async () => {
    const p = await mkPartner();
    const d1 = await mkDriver(), d2 = await mkDriver();
    const { res } = await mkBooking(p);
    const o1 = (await call("/driver/offers", { token: d1.token })).json[0];
    expect((await call(`/driver/offers/${o1.offerId}/accept`, { token: d1.token, body: {} })).status).toBe(201);
    const rideId = res.json.rideId;
    expect((await call(`/driver/rides/${rideId}/cancel`, { token: d1.token, body: {} })).status).toBe(201);

    expect((await call("/driver/offers", { token: d1.token })).json).toHaveLength(0);
    const o2 = (await call("/driver/offers", { token: d2.token })).json;
    expect(o2).toHaveLength(1);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d1.id } })).reliability).toBeCloseTo(0.95);
    expect((await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey })).json.driver).toBeNull();
    expect((await call(`/driver/offers/${o2[0].offerId}/accept`, { token: d2.token, body: {} })).status).toBe(201);
  });

  it("l'admin ne peut pas attribuer à un chauffeur non validé", async () => {
    const p = await mkPartner();
    const pending = await mkDriver({ docs: false });
    const { res } = await mkBooking(p);
    expect((await call(`/admin/rides/${res.json.rideId}/assign`, await manualAssignment(prisma, res.json.rideId, pending.id))).status).toBe(409);
  });
});

describe("onboarding chauffeur", () => {
  it("refuse la validation sans documents valides, puis l'accepte", async () => {
    const d = await mkDriver({ docs: false });
    const r = await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} });
    expect(r.status).toBe(409);
    expect(r.json.missing).toContain("VTC_CARD");
    expect((await call("/driver/availability", { token: d.token, body: { availability: "AVAILABLE" } })).status).toBe(403);

    // upload côté chauffeur puis revue admin ; un document expiré ne compte pas
    const up = await call("/driver/documents", { token: d.token, body: { type: "VTC_CARD", storageKey: "k/vtc", expiresAt: inDays(-1) } });
    await call(`/admin/documents/${up.json.id}/review`, { admin: true, body: { status: "APPROVED" } });
    expect((await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} })).json.missing).toContain("VTC_CARD");
  });
  it("un chauffeur suspendu disparaît de la bourse", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    await call(`/admin/drivers/${d.id}/suspend`, { admin: true, body: {} });
    await mkBooking(p);
    expect((await call("/driver/offers", { token: d.token })).json).toHaveLength(0);
  });
});

describe("webhooks : fiabilité", () => {
  it("reprogramme avec backoff en cas d'échec puis livre quand le partenaire revient", async () => {
    const p = await mkPartner();
    hookStatus = 500;
    await mkBooking(p);
    expect(await webhooks.deliverDue()).toBe(0);
    const failed = await prisma.webhookDelivery.findFirstOrThrow();
    expect(failed.status).toBe("PENDING");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("HTTP 500");
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    hookStatus = 200;
    expect(await webhooks.deliverDue()).toBe(0); // pas encore l'heure
    expect(await webhooks.deliverDue(new Date(Date.now() + 120_000))).toBe(1);
    expect((await prisma.webhookDelivery.findFirstOrThrow()).status).toBe("DELIVERED");
  });
  it("n'enregistre rien pour un partenaire sans webhook", async () => {
    const p = await mkPartner(false);
    await mkBooking(p);
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });
});


/* ============================ Lot 3 : vol, pancarte, société, performance ============================ */

async function assignTo(rideId: string, driverId: string) {
  expect((await call(`/admin/rides/${rideId}/assign`, await manualAssignment(prisma, rideId, driverId))).status).toBe(201);
}
const act = (d: { token: string }, rideId: string, a: string) => call(`/driver/rides/${rideId}/${a}`, { token: d.token, body: {} });

describe("suivi de vol", () => {
  it("propage le retard : webhook, vue chauffeur, heure effective", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    const rideId = res.json.rideId;
    await assignTo(rideId, d.id);
    await webhooks.deliverDue(); received = [];

    const pickupAt = new Date(res.json.pickupAt);
    const est = new Date(pickupAt.getTime() + 62 * 60_000).toISOString();
    const r = await call(`/admin/rides/${rideId}/flight`, { admin: true, body: { estimatedArrivalAt: est } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ changed: true, delayMin: 62, status: "DELAYED" });

    await webhooks.deliverDue();
    const hook = received.map((x) => JSON.parse(x.body)).find((x) => x.type === "flight.delayed");
    expect(hook.data.flight).toMatchObject({ number: "AF1234", status: "DELAYED", delayMin: 62 });
    expect(new Date(hook.data.effectivePickupAt).getTime()).toBe(pickupAt.getTime() + 62 * 60_000);

    const view = (await call(`/driver/rides/${rideId}`, { token: d.token })).json;
    expect(view.flight.delayMin).toBe(62);
    expect(new Date(view.effectivePickupAt).getTime()).toBe(pickupAt.getTime() + 62 * 60_000);

    // même valeur : aucun nouvel événement ; retour à l'heure : webhook de nouveau
    expect((await call(`/admin/rides/${rideId}/flight`, { admin: true, body: { estimatedArrivalAt: est } })).json.changed).toBe(false);
    expect((await call(`/admin/rides/${rideId}/flight`, { admin: true, body: { estimatedArrivalAt: null } })).json).toMatchObject({ changed: true, delayMin: 0, status: "SCHEDULED" });
  });

  it("refuse une mise à jour sans numéro de vol ou sur une course terminée", async () => {
    const p = await mkPartner();
    const { res } = await mkBooking(p, { flightNumber: undefined });
    expect((await call(`/admin/rides/${res.json.rideId}/flight`, { admin: true, body: { status: "DELAYED" } })).status).toBe(409);
  });

  it("le fournisseur branché alimente les retards, au plus une fois par minute", async () => {
    const p = await mkPartner();
    await mkBooking(p, { pickupAt: new Date(Date.now() + 2 * 3600_000).toISOString() });
    flights.provider = { lookup: async (_n, around) => ({ estimatedArrivalAt: new Date(around.getTime() + 30 * 60_000) }) };
    try {
      expect(await flights.poll(new Date(Date.now() + 120_000))).toBe(1);
      expect((await prisma.ride.findFirstOrThrow()).flightDelayMin).toBe(30);
      expect(await flights.poll(new Date(Date.now() + 121_000))).toBe(0); // limité à 1 passage par minute
    } finally { flights.provider = null; }
  });
});

describe("attente et client absent", () => {
  async function arrivedRide() {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    const rideId = res.json.rideId;
    await assignTo(rideId, d.id);
    for (const a of ["en-route", "arrived"]) expect((await act(d, rideId, a)).status).toBe(201);
    return { d, rideId };
  }
  it("impossible avant l'heure de prise en charge, même après 15 min d'attente", async () => {
    const { d, rideId } = await arrivedRide();
    await prisma.rideEvent.updateMany({ where: { rideId, type: "ride.arrived" }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    expect((await act(d, rideId, "no-show")).status).toBe(409); // la prise en charge est dans 3 jours
  });
  it("autorisé 15 min après l'heure effective ; un vol retardé repousse l'autorisation", async () => {
    const { d, rideId } = await arrivedRide();
    await prisma.ride.update({ where: { id: rideId }, data: { pickupAt: new Date(Date.now() - 40 * 60_000) } });
    await prisma.rideEvent.updateMany({ where: { rideId, type: "ride.arrived" }, data: { createdAt: new Date(Date.now() - 35 * 60_000) } });
    await prisma.ride.update({ where: { id: rideId }, data: { flightDelayMin: 120 } });
    const blocked = await act(d, rideId, "no-show");
    expect(blocked.status).toBe(409);
    expect(blocked.json.message).toMatch(/à partir de/);
    await prisma.ride.update({ where: { id: rideId }, data: { flightDelayMin: 0 } });
    expect((await act(d, rideId, "no-show")).status).toBe(201);
  });
  it("expose l'heure d'autorisation et la pancarte au chauffeur", async () => {
    const { d, rideId } = await arrivedRide();
    const v = (await call(`/driver/rides/${rideId}`, { token: d.token })).json;
    expect(v.arrivedAt).toBeTruthy();
    expect(new Date(v.noShowAllowedAt).getTime()).toBeGreaterThan(Date.now());
    expect(v.signText).toBe("Ana Silva");
    expect(v.rideType).toBe("FORFAIT");
    expect((await call(`/driver/rides/${rideId}`, { token: (await mkDriver()).token })).status).toBe(404);
  });
});

describe("pancarte et consignes", () => {
  it("transmet le texte de pancarte et les consignes au chauffeur et au partenaire", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const q = await call("/v1/quotes", { token: p.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 1 } });
    const b = await call("/v1/bookings", {
      token: p.apiKey, headers: { "idempotency-key": "sign" },
      body: { quoteId: q.json.quoteId, signText: "Famille Shoniya — Hôtel Eiffel", notes: "Terminal 3, sortie B", passenger: { firstName: "Zinaida", lastName: "Shoniya", phone: "+33600000001" } },
    });
    expect(b.json.signText).toBe("Famille Shoniya — Hôtel Eiffel");
    await assignTo(b.json.rideId, d.id);
    const v = (await call(`/driver/rides/${b.json.rideId}`, { token: d.token })).json;
    expect(v).toMatchObject({ signText: "Famille Shoniya — Hôtel Eiffel", notes: "Terminal 3, sortie B" });
  });
});

describe("notation", () => {
  it("n'accepte la note qu'après la course et met à jour la moyenne du chauffeur", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    const rideId = res.json.rideId;
    expect((await call(`/v1/bookings/${res.json.id}/rating`, { token: p.apiKey, body: { score: 5 } })).status).toBe(409);
    await assignTo(rideId, d.id);
    await prisma.ride.update({ where: { id: rideId }, data: { status: "COMPLETED" } });
    expect((await call(`/v1/bookings/${res.json.id}/rating`, { token: p.apiKey, body: { score: 6 } })).status).toBe(422);
    expect((await call(`/v1/bookings/${res.json.id}/rating`, { token: p.apiKey, body: { score: 4, comment: "Ponctuel" } })).status).toBe(201);
    expect((await call(`/v1/bookings/${res.json.id}/rating`, { token: p.apiKey, body: { score: 5 } })).status).toBe(201); // remplace
    expect((await prisma.rating.count())).toBe(1);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).rating).toBe(5);
  });
});

describe("espace société", () => {
  async function mkCompany(name: string) {
    const r = await call("/admin/companies", { admin: true, body: { name } });
    expect(r.status).toBe(201);
    return { id: r.json.companyId as string, key: r.json.accessKey as string };
  }
  let seq = 0;
  async function companyDriver(co: { key: string }, category = "BERLINE") {
    const n = ++seq;
    const r = await call("/company/drivers", {
      token: co.key,
      body: { firstName: `Soc${n}`, lastName: "Driver", phone: `+3361234${String(n).padStart(4, "0")}`, email: `soc${n}@test.fr`, vehicle: { plate: `ZZ-${String(n).padStart(3, "0")}-ZZ`, make: "Skoda", model: "Superb", category } },
    });
    expect(r.status).toBe(201);
    const id: string = r.json.id;
    await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: "k", status: "APPROVED" as const })) });
    expect((await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} })).status).toBe(201);
    const token: string = (await call("/driver/login", { body: { phone: r.json.phone, code: "000000" } })).json.token;
    await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
    return { id, token, vehicleId: r.json.vehicles[0].id as string };
  }
  async function finishedRide(p: { apiKey: string }, d: { id: string; token: string }) {
    const { res } = await mkBooking(p);
    const rideId = res.json.rideId;
    await assignTo(rideId, d.id);
    for (const a of ["en-route", "arrived", "start", "complete"]) expect((await act(d, rideId, a)).status).toBe(201);
    return { rideId, bookingId: res.json.id };
  }
  const range = () => `from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 6 * 86400_000).toISOString())}`;

  it("authentifie par clé, refuse l'inconnu", async () => {
    const co = await mkCompany("Taxis CliCab");
    expect((await call("/company/me")).status).toBe(401);
    expect((await call("/company/me", { token: "cmp_nope" })).status).toBe(401);
    expect((await call("/company/me", { token: co.key })).json.name).toBe("Taxis CliCab");
    expect((await call("/company/me", { token: (await mkPartner()).apiKey })).status).toBe(401); // une clé partenaire ne passe pas
  });

  it("refuse deux sociétés avec le même SIRET", async () => {
    const body = { name: "X", siret: "12345678901234" };
    expect((await call("/admin/companies", { admin: true, body })).status).toBe(201);
    expect((await call("/admin/companies", { admin: true, body: { ...body, name: "Y" } })).status).toBe(409);
    expect((await call("/admin/companies", { admin: true, body: { name: "Z", siret: "123" } })).status).toBe(422);
  });

  it("isole les sociétés entre elles", async () => {
    const a = await mkCompany("A"), b = await mkCompany("B");
    const da = await companyDriver(a);
    expect((await call("/company/drivers", { token: b.key })).json).toHaveLength(0);
    expect((await call(`/company/drivers/${da.id}/suspend`, { token: b.key, body: {} })).status).toBe(404);
    expect((await call("/company/rides?driverId=" + da.id, { token: b.key })).status).toBe(404);
    expect((await call("/company/vehicles", { token: b.key, body: { plate: "QQ-111-QQ", make: "A", model: "B", category: "BERLINE", driverId: da.id } })).status).toBe(404);
  });

  it("une société ne lève pas une suspension décidée par la plateforme", async () => {
    const co = await mkCompany("C");
    const d = await companyDriver(co);
    expect((await call(`/company/drivers/${d.id}/suspend`, { token: co.key, body: {} })).status).toBe(201);
    expect((await call(`/company/drivers/${d.id}/resume`, { token: co.key, body: {} })).status).toBe(201);
    await call(`/admin/drivers/${d.id}/suspend`, { admin: true, body: {} });
    const r = await call(`/company/drivers/${d.id}/resume`, { token: co.key, body: {} });
    expect(r.status).toBe(403);
    expect((await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} })).status).toBe(201); // la plateforme peut lever
  });

  it("ajoute des véhicules, refuse les plaques en double", async () => {
    const co = await mkCompany("V");
    const d = await companyDriver(co);
    const ok = await call("/company/vehicles", { token: co.key, body: { plate: "AB-123-CD", make: "Mercedes", model: "Vito", category: "VAN", seats: 8, driverId: d.id } });
    expect(ok.status).toBe(201);
    expect((await call("/company/vehicles", { token: co.key, body: { plate: "AB-123-CD", make: "X", model: "Y", category: "VAN" } })).status).toBe(409);
    expect((await call("/company/vehicles", { token: co.key })).json).toHaveLength(2);
  });

  it("tableau de performance, relevé de paiements et CSV", async () => {
    const co = await mkCompany("Perf");
    const other = await mkCompany("Autre");
    const p = await mkPartner();
    const d = await companyDriver(co);
    const dOther = await companyDriver(other);
    const done = await finishedRide(p, d);
    await call(`/v1/bookings/${done.bookingId}/rating`, { token: p.apiKey, body: { score: 4 } });
    await finishedRide(p, dOther); // course d'une autre société : ne doit jamais apparaître

    const perf = (await call(`/company/performance?${range()}`, { token: co.key })).json;
    expect(perf.totalValueCents).toBe(4400);
    expect(perf.rides).toMatchObject({ finished: 1, completed: 1, perfect: 1, average: 0, poor: 0, noShow: 0 });
    expect(perf.rates.onTimeAtPickupPct).toBe(100);
    expect(perf.rating).toEqual({ count: 1, average: 4 });
    expect(perf.deltaPct).toBeNull();
    expect(perf.series.reduce((s: number, x: any) => s + x.completed, 0)).toBe(1);
    // filtre véhicule / chauffeur
    expect((await call(`/company/performance?${range()}&vehicleId=${d.vehicleId}`, { token: co.key })).json.rides.completed).toBe(1);
    expect((await call(`/company/performance?${range()}&driverId=${dOther.id}`, { token: co.key })).json.rides.completed).toBe(0);
    // vue plateforme : les deux sociétés ; filtrée par société : une seule
    expect((await call(`/admin/performance?${range()}`, { admin: true })).json.rides.completed).toBe(2);
    expect((await call(`/admin/performance?${range()}&companyId=${co.id}`, { admin: true })).json.rides.completed).toBe(1);

    const pay = (await call(`/company/payments?${range()}`, { token: co.key })).json;
    expect(pay.totals).toEqual({ rides: 1, cancellations: 0, penalties: 0, grossCents: 5500, commissionCents: 1100, netCents: 4400 });
    expect(pay.byDriver).toHaveLength(1);

    const csv = await fetch(`${base}/company/payments.csv?${range()}`, { headers: { authorization: `Bearer ${co.key}` } });
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    const text = await csv.text();
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("44");
    expect(text).not.toContain("Soc2"); // pas de fuite de l'autre société
  });

  it("un retard à l'arrivée dégrade la ponctualité, sauf si le vol est en retard", async () => {
    const co = await mkCompany("Late");
    const p = await mkPartner();
    const d = await companyDriver(co);
    const { res } = await mkBooking(p);
    await assignTo(res.json.rideId, d.id);
    for (const a of ["en-route", "arrived", "start", "complete"]) await act(d, res.json.rideId, a);
    // on recule la prise en charge à il y a 40 min : le chauffeur est arrivé 40 min trop tard
    await prisma.ride.update({ where: { id: res.json.rideId }, data: { pickupAt: new Date(Date.now() - 40 * 60_000) } });
    let perf = (await call(`/company/performance?${range()}`, { token: co.key })).json;
    expect(perf.rides).toMatchObject({ poor: 1, perfect: 0 });
    // le vol avait 60 min de retard : l'arrivée est à l'heure
    await prisma.ride.update({ where: { id: res.json.rideId }, data: { flightDelayMin: 60 } });
    perf = (await call(`/company/performance?${range()}`, { token: co.key })).json;
    expect(perf.rides).toMatchObject({ perfect: 1, poor: 0 });
  });

  it("taux d'acceptation et annulations chauffeur", async () => {
    const co = await mkCompany("Acc");
    const p = await mkPartner();
    const d1 = await companyDriver(co), d2 = await companyDriver(co);
    const { res } = await mkBooking(p);
    const o2 = (await call("/driver/offers", { token: d2.token })).json[0];
    await call(`/driver/offers/${o2.offerId}/decline`, { token: d2.token, body: {} });
    const o1 = (await call("/driver/offers", { token: d1.token })).json[0];
    await call(`/driver/offers/${o1.offerId}/accept`, { token: d1.token, body: {} });
    await call(`/driver/rides/${res.json.rideId}/cancel`, { token: d1.token, body: {} });
    const perf = (await call(`/company/performance?${range()}`, { token: co.key })).json;
    expect(perf.rates.acceptancePct).toBe(50); // 1 acceptée, 1 refusée
    expect(perf.rides.driverCancelled).toBe(1);
  });

  it("refuse des périodes invalides", async () => {
    const co = await mkCompany("P");
    expect((await call("/company/performance?from=nope", { token: co.key })).status).toBe(422);
    expect((await call("/company/performance?from=2026-01-01&to=2020-01-01", { token: co.key })).status).toBe(422);
    expect((await call("/company/performance?from=2020-01-01&to=2026-01-01", { token: co.key })).status).toBe(422);
  });
});


/* ============================ Comptes back-office ============================ */

describe("comptes back-office", () => {
  const PW = "une-phrase-de-passe-solide";
  async function mkUser(email: string, role = "DISPATCHER", password = PW) {
    const r = await call("/admin/users", { admin: true, body: { email, name: email.split("@")[0], role, password } });
    expect(r.status).toBe(201);
    return r.json;
  }
  async function login(email: string, password = PW) {
    return call("/auth/login", { body: { email, password } });
  }
  const bearer = (token: string) => ({ token });

  it("connexion : session valide, jamais le hash dans la réponse", async () => {
    await mkUser("Marie@Exemple.fr", "ADMIN");
    const r = await login("marie@exemple.fr");
    expect(r.status).toBe(201);
    expect(r.json.user).toMatchObject({ email: "marie@exemple.fr", role: "ADMIN" });
    expect(JSON.stringify(r.json)).not.toMatch(/scrypt|passwordHash/);
    expect((await call("/admin/rides", bearer(r.json.token))).status).toBe(200);
    expect((await call("/auth/me", bearer(r.json.token))).json).toMatchObject({ email: "marie@exemple.fr", role: "ADMIN", service: false });
  });

  it("identifiants invalides : même réponse pour compte inconnu et mauvais mot de passe", async () => {
    await mkUser("a@exemple.fr");
    const wrong = await login("a@exemple.fr", "mauvais-mot-de-passe-long");
    const unknown = await login("inconnu@exemple.fr", "mauvais-mot-de-passe-long");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.message).toBe(unknown.json.message);
  });

  it("verrouille le compte après 5 échecs, même avec le bon mot de passe", async () => {
    await mkUser("lock@exemple.fr");
    for (let i = 0; i < 5; i++) expect((await login("lock@exemple.fr", "mauvais-mot-de-passe-long")).status).toBe(401);
    expect((await login("lock@exemple.fr")).status).toBe(429);
    await prisma.adminUser.update({ where: { email: "lock@exemple.fr" }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login("lock@exemple.fr")).status).toBe(201);
  });

  it("un régulateur gère les courses mais ne crée ni partenaire, ni société, ni compte", async () => {
    await mkUser("regul@exemple.fr", "DISPATCHER");
    const t = (await login("regul@exemple.fr")).json.token;
    expect((await call("/admin/rides", bearer(t))).status).toBe(200);
    expect((await call("/admin/alerts", bearer(t))).status).toBe(200);
    for (const [path, body] of [["/admin/partners", { name: "X" }], ["/admin/companies", { name: "X" }], ["/admin/users", { email: "z@exemple.fr", name: "Z", password: PW }]] as const) {
      expect((await call(path, { ...bearer(t), body })).status).toBe(403);
    }
    const d = await mkDriver({ docs: false });
    expect((await call(`/admin/drivers/${d.id}/approve`, { ...bearer(t), body: {} })).status).toBe(403);
  });

  it("changer le mot de passe ou désactiver le compte coupe les sessions ouvertes", async () => {
    const u = await mkUser("rev@exemple.fr", "ADMIN");
    await mkUser("autre-admin@exemple.fr", "ADMIN");
    const t1 = (await login("rev@exemple.fr")).json.token;
    expect((await call("/auth/password", { ...bearer(t1), body: { current: PW, next: "nouvelle-phrase-de-passe-2" } })).status).toBe(201);
    expect((await call("/auth/me", bearer(t1))).status).toBe(401); // ancienne session révoquée
    expect((await login("rev@exemple.fr")).status).toBe(401); // ancien mot de passe
    const t2 = (await login("rev@exemple.fr", "nouvelle-phrase-de-passe-2")).json.token;
    expect((await call("/auth/me", bearer(t2))).status).toBe(200);
    expect((await call(`/admin/users/${u.id}/deactivate`, { admin: true, body: {} })).status).toBe(201);
    expect((await call("/auth/me", bearer(t2))).status).toBe(401);
    expect((await login("rev@exemple.fr", "nouvelle-phrase-de-passe-2")).status).toBe(401);
  });

  it("refuse un mot de passe trop faible, un doublon, et la désactivation du dernier administrateur", async () => {
    expect((await call("/admin/users", { admin: true, body: { email: "f@exemple.fr", name: "F", password: "court" } })).status).toBe(422);
    const u = await mkUser("solo@exemple.fr", "ADMIN");
    expect((await call("/admin/users", { admin: true, body: { email: "SOLO@exemple.fr", name: "S", password: PW } })).status).toBe(409);
    expect((await call(`/admin/users/${u.id}/deactivate`, { admin: true, body: {} })).status).toBe(409);
  });

  it("refuse les jetons d'une autre nature et le token de service quand il est désactivé", async () => {
    const p = await mkPartner();
    expect((await call("/admin/rides", { token: p.apiKey })).status).toBe(401); // clé partenaire
    const d = await mkDriver();
    expect((await call("/admin/rides", { token: d.token })).status).toBe(401); // jeton chauffeur
    const saved = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "";
    try { expect((await call("/admin/rides", { admin: true })).status).toBe(401); } finally { process.env.ADMIN_TOKEN = saved; }
  });

  it("exige le consentement explicite et journalise la déclaration du régulateur après attribution", async () => {
    const user = await mkUser("consent@exemple.fr", "DISPATCHER");
    const token = (await login("consent@exemple.fr")).json.token;
    const p = await mkPartner(false);
    const driver = await mkDriver();
    const { res } = await mkBooking(p);
    const rideId = res.json.rideId;
    const path = `/admin/rides/${rideId}/assign`;
    const details = { driverId: driver.id, priceCents: 4000 };
    const body = { ...details, verbalConsentConfirmed: true };
    const events = () => prisma.rideEvent.findMany({ where: { rideId, type: "ride.assignment_consent_declared" } });

    expect((await call(path, { body })).status).toBe(401);
    expect((await call(path, { token: driver.token, body })).status).toBe(401);
    expect((await call(path, { admin: true, body })).status).toBe(403);
    expect((await call(path, { token, body: details })).status).toBe(422);
    for (const value of [false, "true", 1, null]) {
      expect((await call(path, { token, body: { ...details, verbalConsentConfirmed: value } })).status).toBe(422);
    }
    expect((await call(path, { token, body: { driverId: driver.id, verbalConsentConfirmed: true } })).status).toBe(422);
    expect(await events()).toEqual([]);
    expect(await prisma.ride.findUniqueOrThrow({ where: { id: rideId } })).toMatchObject({ status: "DISPATCHING", driverId: null });

    const results = await Promise.all([call(path, { token, body }), call(path, { token, body })]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
    const declarations = await events();
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      rideId,
      actor: "admin:consent@exemple.fr",
      createdAt: expect.any(Date),
      payload: { dispatcherId: user.id, driverId: driver.id, method: "PHONE", agreedPriceCents: 4000, driverNetCents: 4000, ecoBonusCents: 0 },
    });
    const inbox = await call("/driver/notifications", { token: driver.token });
    expect(inbox.json.items.filter((item: { type: string }) => item.type === "ASSIGNED_BY_DISPATCH")).toHaveLength(1);
  });

  it("journalise connexions, échecs et gestion des comptes, avec l'acteur sur les actions", async () => {
    await mkUser("audit@exemple.fr", "ADMIN");
    await login("audit@exemple.fr", "mauvais-mot-de-passe-long");
    const t = (await login("audit@exemple.fr")).json.token;
    const p = await mkPartner(false);
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    await call(`/admin/rides/${res.json.rideId}/assign`, { ...bearer(t), body: { driverId: d.id, priceCents: 4000, verbalConsentConfirmed: true } });
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.created", "login.failed", "login.ok"]));
    const ev = await prisma.rideEvent.findFirst({ where: { rideId: res.json.rideId, type: "ride.assigned" } });
    expect(ev?.actor).toBe("admin:audit@exemple.fr");
  });
});


/* ============================ Codes SMS à usage unique ============================ */

describe("codes SMS des chauffeurs", () => {
  let sent: { to: string; text: string }[] = [];
  let sms: SmsService;
  const savedDev = process.env.DRIVER_DEV_OTP;
  beforeEach(() => {
    sent = [];
    sms = app.get(SmsService);
    sms.provider = { send: async (to, text) => { sent.push({ to, text }); } };
    process.env.DRIVER_DEV_OTP = ""; // on teste le vrai flux, pas le code de développement
  });
  afterAll(() => { process.env.DRIVER_DEV_OTP = savedDev; });
  // Les chauffeurs de test se connectent d'abord avec le code de développement (le temps de les créer).
  const mk = async () => { process.env.DRIVER_DEV_OTP = "000000"; try { return await mkDriver(); } finally { process.env.DRIVER_DEV_OTP = ""; } };
  const lastCode = () => /(\d{6})/.exec(sent[sent.length - 1].text)![1];
  const requestCode = (phone: string) => call("/driver/otp", { body: { phone } });
  const loginWith = (phone: string, code: string) => call("/driver/login", { body: { phone, code } });

  it("envoie un code à 6 chiffres, valable une seule fois", async () => {
    const d = await mk();
    expect((await requestCode(d.phone)).status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(d.phone);
    const code = lastCode();
    const ok = await loginWith(d.phone, code);
    expect(ok.status).toBe(201);
    expect(ok.json.driverId).toBe(d.id);
    expect((await call("/driver/me", { token: ok.json.token })).status).toBe(200);
    expect((await loginWith(d.phone, code)).status).toBe(401); // déjà utilisé
  });

  it("n'enregistre jamais le code en clair", async () => {
    const d = await mk();
    await requestCode(d.phone);
    const row = await prisma.otpCode.findFirstOrThrow({ where: { phone: d.phone } });
    expect(row.codeHash).not.toContain(lastCode());
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepte un numéro saisi à la française", async () => {
    const d = await mk();
    const local = "0" + d.phone.slice(3); // +33600000001 → 0600000001
    expect((await requestCode(local)).status).toBe(201);
    expect(sent[0].to).toBe(d.phone);
    expect((await loginWith(local, lastCode())).status).toBe(201);
  });

  it("répond pareil pour un numéro inconnu, sans envoyer de SMS", async () => {
    const d = await mk();
    const known = await requestCode(d.phone);
    const unknown = await requestCode("+33699999999");
    expect(unknown.status).toBe(known.status);
    expect(unknown.json).toEqual(known.json);
    expect(sent.map((s) => s.to)).toEqual([d.phone]);
    expect((await loginWith("+33699999999", "123456")).status).toBe(401);
    expect((await requestCode("pas un numéro")).status).toBe(422);
  });

  it("bloque le code après 5 essais erronés, même avec le bon code ensuite", async () => {
    const d = await mk();
    await requestCode(d.phone);
    const good = lastCode();
    const wrong = good === "000001" ? "000002" : "000001";
    for (let i = 0; i < OTP.maxAttempts; i++) expect((await loginWith(d.phone, wrong)).status).toBe(401);
    expect((await loginWith(d.phone, good)).status).toBe(401);
  });

  it("refuse un code expiré", async () => {
    const d = await mk();
    await requestCode(d.phone);
    await prisma.otpCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await loginWith(d.phone, lastCode())).status).toBe(401);
  });

  it("un nouveau code invalide le précédent ; renvoi limité (30 s, 3 par 10 min)", async () => {
    const d = await mk();
    await requestCode(d.phone);
    const first = lastCode();
    expect((await requestCode(d.phone)).status).toBe(429); // trop tôt
    await prisma.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
    expect((await requestCode(d.phone)).status).toBe(201);
    expect((await loginWith(d.phone, first)).status).toBe(401); // ancien code périmé
    await prisma.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 50_000) } });
    expect((await requestCode(d.phone)).status).toBe(201); // 3e dans la fenêtre
    await prisma.otpCode.updateMany({ data: { createdAt: new Date(Date.now() - 40_000) } });
    expect((await requestCode(d.phone)).status).toBe(429); // 4e : fenêtre épuisée
  });

  it("consommation atomique : deux connexions simultanées avec le même code, une seule réussit", async () => {
    const d = await mk();
    await requestCode(d.phone);
    const code = lastCode();
    const rs = await Promise.all([1, 2, 3, 4].map(() => loginWith(d.phone, code)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it("limite les demandes par adresse IP", async () => {
    const saved = process.env.OTP_IP_PER_MIN;
    process.env.OTP_IP_PER_MIN = "3";
    (app.get(OtpService) as any).ipHits.clear(); // repart d'un compteur vide
    try {
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await requestCode(`+3369999000${i}`)).status);
      expect(codes).toEqual([201, 201, 201, 429]);
    } finally { process.env.OTP_IP_PER_MIN = saved; }
  });

  it("répond 501 si aucun fournisseur SMS n'est configuré (et pas de code de développement)", async () => {
    sms.provider = null;
    const d = await mk();
    expect((await requestCode(d.phone)).status).toBe(501);
  });

  it("le code de développement ne fonctionne que s'il est défini, et jamais en production", async () => {
    const d = await mk();
    expect((await loginWith(d.phone, "000000")).status).toBe(401); // non défini ici
    process.env.DRIVER_DEV_OTP = "424242";
    expect((await loginWith(d.phone, "424242")).status).toBe(201);
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { expect((await loginWith(d.phone, "424242")).status).toBe(401); } finally { process.env.NODE_ENV = env; }
  });
});


/* ============================ Annulation : information du chauffeur ============================ */

describe("annulation par le partenaire : information du chauffeur", () => {
  let mails: { to: string; subject: string; text: string }[] = [];
  let emailSvc: EmailService;
  beforeEach(() => {
    mails = [];
    emailSvc = app.get(EmailService);
    emailSvc.provider = { send: async (m) => { mails.push(m); } };
  });
  afterAll(() => { emailSvc.provider = null; });

  async function assigned(hours: number, over: Record<string, unknown> = {}) {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p, { pickupAt: new Date(Date.now() + hours * 3600_000).toISOString(), ...over });
    await assignTo(res.json.rideId, d.id);
    mails.length = 0; // l'attribution envoie sa propre confirmation ; on ne regarde ici que l'annulation
    return { p, d, res };
  }
  const cancel = (p: { apiKey: string }, id: string) => call(`/v1/bookings/${id}`, { token: p.apiKey, method: "DELETE" });
  const inbox = async (d: { token: string }) => (await call("/driver/notifications", { token: d.token })).json;

  it("prévient le chauffeur (application + e-mail) et l'indemnise si l'annulation est tardive", async () => {
    const { p, d, res } = await assigned(5);
    const c = await cancel(p, res.json.id);
    expect(c.status).toBe(200);
    expect(c.json.cancellationFee).toBe(27.5);

    const box = await inbox(d);
    expect(box.unread).toBe(2); // l'attribution manuelle, puis l'annulation
    const n = box.items.find((x: any) => x.type === "RIDE_CANCELLED");
    expect(n.title).toBe(`Mission R-${res.json.ref} annulée`);
    expect(n.body).toMatch(/Indemnité d'annulation : 22,00\s€/);
    expect(n.body).toContain("Aéroport CDG T2");
    expect(n.body).toContain("AF1234");
    expect(n.data).toMatchObject({ ref: res.json.ref, compensationCents: 2200 });

    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: driver.email, subject: n.title });
    expect(mails[0].text).toContain(n.body);

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } });
    expect(ride).toMatchObject({ status: "CANCELLED_BY_PARTNER", cancellationFeeCents: 2750, driverCompensationCents: 2200 });
  });

  it("la mission annulée quitte l'agenda, apparaît dans les archives avec l'indemnité, et reste consultable", async () => {
    const { p, d, res } = await assigned(5);
    await cancel(p, res.json.id);
    expect((await call("/driver/rides?scope=upcoming", { token: d.token })).json).toHaveLength(0);
    const hist = (await call("/driver/rides?scope=history", { token: d.token })).json;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ status: "CANCELLED_BY_PARTNER", compensationCents: 2200, reference: `R-${res.json.ref}` });
    expect((await call(`/driver/rides/${res.json.rideId}`, { token: d.token })).json.status).toBe("CANCELLED_BY_PARTNER");
    expect((await act(d, res.json.rideId, "en-route")).status).toBe(409); // plus aucune action possible
  });

  it("aucune indemnité si l'annulation est anticipée (plus de 24 h)", async () => {
    const { p, d, res } = await assigned(48);
    expect((await cancel(p, res.json.id)).json.cancellationFee).toBe(0);
    const n = (await inbox(d)).items[0];
    expect(n.body).toContain("Aucune indemnité d'annulation n'est due.");
    expect(n.data.compensationCents).toBe(0);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } })).driverCompensationCents).toBe(0);
  });

  it("ne prévient personne quand aucun chauffeur n'était affecté", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p, { pickupAt: new Date(Date.now() + 5 * 3600_000).toISOString() });
    await cancel(p, res.json.id);
    expect((await inbox(d)).items).toHaveLength(0);
    expect(mails).toHaveLength(0);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } })).driverCompensationCents).toBe(0);
  });

  it("un échec d'envoi d'e-mail n'empêche ni l'annulation ni le message dans l'application", async () => {
    emailSvc.provider = { send: async () => { throw new Error("SMTP indisponible"); } };
    const { p, d, res } = await assigned(5);
    expect((await cancel(p, res.json.id)).status).toBe(200);
    expect((await inbox(d)).items.map((x: any) => x.type)).toContain("RIDE_CANCELLED");
  });

  it("chaque chauffeur ne voit et ne marque que ses propres messages", async () => {
    const { p, d, res } = await assigned(5);
    await cancel(p, res.json.id);
    const other = await mkDriver();
    expect((await inbox(other)).items).toHaveLength(0);
    expect((await call("/driver/notifications/read", { token: other.token, body: {} })).json.marked).toBe(0);
    expect((await inbox(d)).unread).toBe(2); // intact (attribution + annulation)
    expect((await call("/driver/home", { token: d.token })).json.unreadNotifications).toBe(2);
    const id = (await inbox(d)).items[0].id; // le plus récent : l'annulation
    expect((await call("/driver/notifications/read", { token: d.token, body: { ids: [id] } })).json.marked).toBe(1);
    expect((await inbox(d)).unread).toBe(1);
    expect((await call("/driver/notifications/read", { token: d.token, body: {} })).json.marked).toBe(1); // sans ids : tout le reste
    expect((await inbox(d)).unread).toBe(0);
    expect((await call("/driver/notifications/read", { token: d.token, body: { ids: ["pas-un-uuid"] } })).status).toBe(422);
  });

  it("l'attribution manuelle et un retard de vol laissent aussi un message", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    await assignTo(res.json.rideId, d.id);
    const est = new Date(new Date(res.json.pickupAt).getTime() + 62 * 60_000).toISOString();
    await call(`/admin/rides/${res.json.rideId}/flight`, { admin: true, body: { estimatedArrivalAt: est } });
    const types = (await inbox(d)).items.map((x: any) => x.type);
    expect(types).toEqual(expect.arrayContaining(["ASSIGNED_BY_DISPATCH", "FLIGHT_UPDATE"]));
    expect((await inbox(d)).items.find((x: any) => x.type === "FLIGHT_UPDATE").title).toContain("+62 min");
  });
});

describe("référence courte et délai d'atterrissage", () => {
  it("chaque mission a une référence R-xxxxxx croissante, visible partout", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const a = (await mkBooking(p)).res.json, b = (await mkBooking(p)).res.json;
    expect(a.ref).toBeGreaterThanOrEqual(100001);
    expect(b.ref).toBe(a.ref + 1);
    expect(a.reference).toBe(`R-${a.ref}`);
    await assignTo(a.rideId, d.id);
    expect((await call(`/driver/rides/${a.rideId}`, { token: d.token })).json.reference).toBe(`R-${a.ref}`);
    expect((await call(`/v1/bookings/${a.id}`, { token: p.apiKey })).json.reference).toBe(`R-${a.ref}`);
  });

  it("le retard de vol se mesure sur l'atterrissage, pas sur la prise en charge", async () => {
    const p = await mkPartner();
    const { res } = await mkBooking(p, {}, "buf", { flightBufferMin: 15 });
    const pickup = new Date(res.json.pickupAt).getTime();
    expect(res.json.flight).toMatchObject({ bufferMin: 15, scheduledArrivalAt: new Date(pickup - 15 * 60_000).toISOString() });
    // atterrit à 62 min après l'heure prévue d'atterrissage
    const est = new Date(pickup - 15 * 60_000 + 62 * 60_000).toISOString();
    const r = await call(`/admin/rides/${res.json.rideId}/flight`, { admin: true, body: { estimatedArrivalAt: est } });
    expect(r.json.delayMin).toBe(62);
    const view = (await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey })).json;
    expect(new Date(view.effectivePickupAt).getTime()).toBe(pickup + 62 * 60_000);
  });

  it("sans numéro de vol, le délai est ignoré ; valeurs aberrantes refusées", async () => {
    const p = await mkPartner();
    const { res } = await mkBooking(p, { flightNumber: undefined }, "nobuf", { flightBufferMin: 30 });
    expect(res.status).toBe(201);
    expect((await prisma.ride.findFirstOrThrow({ where: { id: res.json.rideId } })).flightBufferMin).toBe(0);
    const { res: bad } = await mkBooking(p, {}, "bad", { flightBufferMin: 999 });
    expect(bad.status).toBe(422);
  });
});

describe("relevé de paiement : indemnités d'annulation", () => {
  it("liste l'indemnité séparément, dans le total et dans le CSV", async () => {
    const co = (await call("/admin/companies", { admin: true, body: { name: "Indemn" } })).json;
    const created = await call("/company/drivers", { token: co.accessKey, body: { firstName: "Ind", lastName: "Emn", phone: "+33698765432", email: "ind@test.fr", vehicle: { plate: "IN-123-DM", make: "Skoda", model: "Superb", category: "BERLINE" } } });
    const id: string = created.json.id;
    await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: "k", status: "APPROVED" as const })) });
    await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} });
    const p = await mkPartner();
    const { res } = await mkBooking(p, { pickupAt: new Date(Date.now() + 5 * 3600_000).toISOString() });
    await assignTo(res.json.rideId, id);
    await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey, method: "DELETE" });

    const range = `from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 2 * 86400_000).toISOString())}`;
    // période par défaut (15 derniers jours) : l'indemnité y figure dès l'annulation, même si la prise en charge est dans le futur
    expect((await call("/company/payments", { token: co.accessKey })).json.totals.cancellations).toBe(1);
    const pay = (await call(`/company/payments?${range}`, { token: co.accessKey })).json;
    expect(pay.totals).toEqual({ rides: 0, cancellations: 1, penalties: 0, grossCents: 2750, commissionCents: 550, netCents: 2200 });
    expect(pay.rows[0]).toMatchObject({ kind: "ANNULATION", reference: `R-${res.json.ref}`, netCents: 2200 });
    expect(pay.byDriver[0]).toMatchObject({ rides: 0, netCents: 2200 }); // payé, mais pas compté comme mission réalisée
    const csv = await (await fetch(`${base}/company/payments.csv?${range}`, { headers: { authorization: `Bearer ${co.accessKey}` } })).text();
    expect(csv).toContain("ANNULATION");
    expect(csv).toContain("22");
  });
});


/* ============================ Confirmation d'acceptation ============================ */

describe("confirmation d'acceptation d'une mission", () => {
  let mails: { to: string; subject: string; text: string }[] = [];
  let emailSvc: EmailService;
  beforeEach(() => {
    mails = [];
    emailSvc = app.get(EmailService);
    emailSvc.provider = { send: async (m) => { mails.push(m); } };
  });
  afterAll(() => { emailSvc.provider = null; });
  const inbox = async (d: { token: string }) => (await call("/driver/notifications", { token: d.token })).json.items;

  it("le chauffeur qui accepte reçoit un message et un e-mail détaillés, prix compris", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p, {}, "acc", { flightBufferMin: 15 });
    const offer = (await call("/driver/offers", { token: d.token })).json[0];
    expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);

    const n = (await inbox(d)).find((x: any) => x.type === "RIDE_ACCEPTED");
    expect(n.title).toBe(`Mission R-${res.json.ref} confirmée`);
    expect(n.body).toContain(`Vous avez accepté la mission R-${res.json.ref}`);
    for (const part of ["Prise en charge :", "Départ : Aéroport CDG T2", "Arrivée :", "Vol : AF1234", "prise en charge 15 min après", "Service : Berline · course au forfait", "Prix client (TTC) : 55,00", "Commission de la plateforme : 11,00", "Votre rémunération (net) : 44,00", "application chauffeur"]) {
      expect(n.body).toContain(part);
    }
    expect(n.body).not.toContain("Silva"); // pas de données du passager dans un e-mail
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: driver.email, subject: n.title });
    expect(mails[0].text).toContain(n.body);
  });

  it("un seul message pour le chauffeur gagnant, aucun pour celui qui perd la course", async () => {
    const p = await mkPartner();
    const d1 = await mkDriver(), d2 = await mkDriver();
    await mkBooking(p);
    const o1 = (await call("/driver/offers", { token: d1.token })).json[0], o2 = (await call("/driver/offers", { token: d2.token })).json[0];
    const rs = await Promise.all([
      call(`/driver/offers/${o1.offerId}/accept`, { token: d1.token, body: {} }),
      call(`/driver/offers/${o2.offerId}/accept`, { token: d2.token, body: {} }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const total = [...(await inbox(d1)), ...(await inbox(d2))].filter((x: any) => x.type === "RIDE_ACCEPTED");
    expect(total).toHaveLength(1);
    expect(mails.filter((m) => /confirmée/.test(m.subject))).toHaveLength(1);
  });

  it("une attribution par le dispatch envoie la même confirmation, formulée autrement", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    await assignTo(res.json.rideId, d.id);
    const n = (await inbox(d)).find((x: any) => x.type === "ASSIGNED_BY_DISPATCH");
    expect(n.title).toBe(`Mission R-${res.json.ref} attribuée`);
    expect(n.body).toContain(`Le dispatch vous a attribué la mission R-${res.json.ref}`);
    expect(n.body).toContain("Votre rémunération (net) : 44,00");
    expect(mails.map((m) => m.subject)).toContain(n.title);
  });

  it("peut masquer le prix client et la commission (DRIVER_SEES_CLIENT_PRICE=0)", async () => {
    process.env.DRIVER_SEES_CLIENT_PRICE = "0";
    try {
      const p = await mkPartner();
      const d = await mkDriver();
      await mkBooking(p);
      const offer = (await call("/driver/offers", { token: d.token })).json[0];
      await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} });
      const body = (await inbox(d)).find((x: any) => x.type === "RIDE_ACCEPTED").body;
      expect(body).toContain("Votre rémunération (net) : 44,00");
      expect(body).not.toContain("Prix client");
      expect(body).not.toContain("Commission");
    } finally { delete process.env.DRIVER_SEES_CLIENT_PRICE; }
  });

  it("un e-mail en panne n'empêche pas l'acceptation", async () => {
    emailSvc.provider = { send: async () => { throw new Error("SMTP indisponible"); } };
    const p = await mkPartner();
    const d = await mkDriver();
    await mkBooking(p);
    const offer = (await call("/driver/offers", { token: d.token })).json[0];
    expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} })).status).toBe(201);
    expect((await inbox(d)).map((x: any) => x.type)).toContain("RIDE_ACCEPTED");
  });
});


/* ============================ Échelle de prix : le prix chauffeur monte à l'approche de la mission ============================ */

describe("échelle de prix chauffeur", () => {
  beforeEach(() => { process.env.PRICE_LADDER = "1"; });
  afterEach(() => { process.env.PRICE_LADDER = "0"; });
  const offerOf = async (d: { token: string }) => (await call("/driver/offers", { token: d.token })).json[0];
  const moveTo = (rideId: string, minutesFromNow: number) => prisma.ride.update({ where: { id: rideId }, data: { pickupAt: new Date(Date.now() + minutesFromNow * 60_000) } });

  it("propose 85 % du plafond loin de la mission, et le prix accepté est celui de l'instant", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p); // plafond : 55 € − 20 % = 44 €
    const offer = await offerOf(d);
    expect(offer.netCents).toBe(3740);
    expect(offer.priceRising).toBe(true);
    expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: { priceCents: 99999 } })).status).toBe(201); // le client ne fixe pas le prix

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } });
    expect(ride).toMatchObject({ driverCapCents: 4400, driverNetCents: 3740, commissionCents: 5500 - 3740, priceCents: 5500 });
    const ev = await prisma.rideEvent.findFirstOrThrow({ where: { rideId: ride.id, type: "ride.assigned" } });
    expect(ev.payload).toMatchObject({ capCents: 4400, acceptedCents: 3740 });
    const view = (await call(`/driver/rides/${ride.id}`, { token: d.token })).json;
    expect(view.netCents).toBe(3740);
  });

  it("le prix monte quand la mission approche, jusqu'au plafond", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    const prices: number[] = [];
    for (const minutes of [3 * 24 * 60, 12 * 60, 90, 30]) {
      await moveTo(res.json.rideId, minutes);
      prices.push((await offerOf(d)).netCents);
    }
    expect(prices[0]).toBe(3740);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    expect(prices[2]).toBe(4380); // 90 min avant : 99,7 % du plafond, arrondi au pas de 0,10 €
    expect(prices[3]).toBe(4400); // moins d'1 h avant : plafond
    await moveTo(res.json.rideId, 30);
    expect((await offerOf(d)).priceRising).toBe(false);
  });

  it("un chauffeur qui accepte tard est payé plus cher qu'un chauffeur qui accepte tôt", async () => {
    const p = await mkPartner();
    const early = await mkDriver(), late = await mkDriver();
    const a = await mkBooking(p, {}, "early"), b = await mkBooking(p, {}, "late");
    await call(`/driver/offers/${(await offerOf(early)).offerId}/accept`, { token: early.token, body: {} }).catch(() => null);
    // `early` prend l'une des deux courses au prix de départ
    const rideEarly = (await prisma.ride.findMany({ where: { driverId: early.id } }))[0];
    expect(rideEarly.driverNetCents).toBe(3740);
    // l'autre course approche : `late` l'accepte plus cher
    const other = rideEarly.id === a.res.json.rideId ? b.res.json.rideId : a.res.json.rideId;
    await moveTo(other, 45);
    const offer = (await call("/driver/offers", { token: late.token })).json.find((o: any) => o.netCents === 4400);
    expect(offer).toBeTruthy();
    expect((await call(`/driver/offers/${offer.offerId}/accept`, { token: late.token, body: {} })).status).toBe(201);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: other } })).driverNetCents).toBe(4400);
  });

  it("la confirmation montre client, plafond et prix accepté ; la marge n'apparaît pas", async () => {
    const mails: { text: string }[] = [];
    const email = app.get(EmailService);
    email.provider = { send: async (m) => { mails.push(m); } };
    try {
      const p = await mkPartner();
      const d = await mkDriver();
      await mkBooking(p);
      await call(`/driver/offers/${(await offerOf(d)).offerId}/accept`, { token: d.token, body: {} });
      const body = (await call("/driver/notifications", { token: d.token })).json.items.find((x: any) => x.type === "RIDE_ACCEPTED").body;
      expect(body).toMatch(/Prix client \(TTC\) : 55,00\s€/);
      expect(body).toMatch(/Prix partenaire prévisionnel \(plafond\) : 44,00\s€/);
      expect(body).toMatch(/Prix partenaire accepté \(votre rémunération\) : 37,40\s€/);
      expect(body).not.toMatch(/marge/i);
    } finally { email.provider = null; }
  });

  it("le montant convenu peut atteindre le plafond, jamais le dépasser", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    const over = await call(`/admin/rides/${res.json.rideId}/assign`, await manualAssignment(prisma, res.json.rideId, d.id, 4401));
    expect(over.status).toBe(422);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } })).status).toBe("DISPATCHING"); // rien n'a changé
    expect((await call(`/admin/rides/${res.json.rideId}/assign`, await manualAssignment(prisma, res.json.rideId, d.id, 4000))).status).toBe(201);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } }))).toMatchObject({ driverNetCents: 4000, commissionCents: 1500 });
  });

  it("l’attribution manuelle conserve le prix convenu au plafond", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    await moveTo(res.json.rideId, 20); // urgence : plafond
    expect((await call(`/admin/rides/${res.json.rideId}/assign`, await manualAssignment(prisma, res.json.rideId, d.id, 4400))).status).toBe(201);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } })).driverNetCents).toBe(4400);
  });

  it("l'indemnité d'annulation suit le prix réellement accepté", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p, { pickupAt: new Date(Date.now() + 5 * 3600_000).toISOString() });
    const offer = await offerOf(d);
    await call(`/driver/offers/${offer.offerId}/accept`, { token: d.token, body: {} });
    const accepted = (await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } })).driverNetCents;
    expect(accepted).toBe(4280); // 5 h avant : 97,4 % du plafond
    await call(`/v1/bookings/${res.json.id}`, { token: p.apiKey, method: "DELETE" });
    const r = await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } });
    // frais 50 % de 55 € = 27,50 € ; la plateforme garde (55 − 42,80)/55 = 22,2 % → le chauffeur reçoit 21,40 €
    expect(r).toMatchObject({ cancellationFeeCents: 2750, driverCompensationCents: 2140 });
  });

  it("une mission antérieure à l'échelle (sans plafond enregistré) garde son prix net comme plafond", async () => {
    const p = await mkPartner();
    const d = await mkDriver();
    const { res } = await mkBooking(p);
    await prisma.ride.update({ where: { id: res.json.rideId }, data: { driverCapCents: 0 } });
    expect((await offerOf(d)).netCents).toBe(3740);
    await call(`/driver/offers/${(await offerOf(d)).offerId}/accept`, { token: d.token, body: {} });
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: res.json.rideId } })).driverCapCents).toBe(4400);
  });

  it("désactivée (PRICE_LADDER=0) : toujours le plafond", async () => {
    process.env.PRICE_LADDER = "0";
    const p = await mkPartner();
    const d = await mkDriver();
    await mkBooking(p);
    const offer = await offerOf(d);
    expect(offer.netCents).toBe(4400);
    expect(offer.priceRising).toBe(false);
  });

  it("la marge de la plateforme est visible côté administration, jamais côté société", async () => {
    const co = (await call("/admin/companies", { admin: true, body: { name: "Marge" } })).json;
    const created = await call("/company/drivers", { token: co.accessKey, body: { firstName: "Mar", lastName: "Ge", phone: "+33677700001", email: "marge@test.fr", vehicle: { plate: "MA-123-RG", make: "Skoda", model: "Superb", category: "BERLINE" } } });
    const id: string = created.json.id;
    await prisma.document.createMany({ data: ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"].map((type) => ({ driverId: id, type: type as any, storageKey: "k", status: "APPROVED" as const })) });
    await call(`/admin/drivers/${id}/approve`, { admin: true, body: {} });
    const token: string = (await call("/driver/login", { body: { phone: created.json.phone, code: "000000" } })).json.token;
    await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
    const p = await mkPartner();
    const { res } = await mkBooking(p);
    await call(`/driver/offers/${(await offerOf({ token })).offerId}/accept`, { token, body: {} });
    for (const a of ["en-route", "arrived", "start", "complete"]) await call(`/driver/rides/${res.json.rideId}/${a}`, { token, body: {} });

    const range = `from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 6 * 86400_000).toISOString())}`;
    const admin = (await call(`/admin/performance?${range}`, { admin: true })).json;
    expect(admin.totalValueCents).toBe(3740);
    expect(admin.platform).toMatchObject({ marginCents: 5500 - 3740, ladderSavingsCents: 4400 - 3740, acceptedVsCapPct: 85 });
    const company = (await call(`/company/performance?${range}`, { token: co.accessKey })).json;
    expect(company.totalValueCents).toBe(3740);
    expect(company).not.toHaveProperty("platform");
    const pay = (await call(`/company/payments?${range}`, { token: co.accessKey })).json;
    expect(pay.totals).toMatchObject({ netCents: 3740, grossCents: 5500 });
  });
});

it("refuse une deuxième attribution simultanée au même chauffeur sur le même créneau", async () => {
  const partner = await mkPartner(false);
  const driver = await mkDriver();
  const pickupAt = inDays(3);
  const first = await mkBooking(partner, { pickupAt }, "double-attribution-1");
  const second = await mkBooking(partner, { pickupAt }, "double-attribution-2");
  const results = await Promise.all([first, second].map(async ({ res }) =>
    call(`/admin/rides/${res.json.rideId}/assign`, await manualAssignment(prisma, res.json.rideId, driver.id)),
  ));
  expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
  expect(await prisma.ride.count({ where: { driverId: driver.id, status: "ASSIGNED" } })).toBe(1);
});

it("exporte les montants des courses réelles du partenaire et exclut les courses de test", async () => {
  const partner = await mkPartner(false);
  const liveKey = generateApiKey(false);
  await prisma.apiKey.create({ data: { partnerId: partner.partnerId, keyHash: liveKey.hash, prefix: liveKey.prefix, sandbox: false } });
  const driver = await mkDriver();
  const completed = await mkBooking({ apiKey: liveKey.key }, {}, "releve-complete", { externalReference: "=FORMULE" });
  await assignTo(completed.res.json.rideId, driver.id);
  for (const action of ["en-route", "arrived", "start", "complete"]) {
    expect((await act(driver, completed.res.json.rideId, action)).status).toBe(201);
  }
  const cancelled = await mkBooking({ apiKey: liveKey.key }, {
    pickupAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
  }, "releve-cancelled");
  await assignTo(cancelled.res.json.rideId, driver.id);
  expect((await call(`/v1/bookings/${cancelled.res.json.id}`, { token: liveKey.key, method: "DELETE" })).status).toBe(200);
  const sandbox = await mkBooking(partner, {}, "releve-sandbox");
  expect((await call(`/v1/bookings/${sandbox.res.json.id}`, { token: partner.apiKey, method: "DELETE" })).status).toBe(200);

  const path = `/admin/partners/${partner.partnerId}/statement.csv?from=${inDays(-1)}&to=${inDays(5)}`;
  expect((await call(path)).status).toBe(401);
  const response = await fetch(base + path, { headers: { "x-admin-token": "test-admin-token-test-admin-token" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/csv");
  const lines = (await response.text()).split("\n");
  expect(lines).toHaveLength(3);
  const completedRide = await prisma.ride.findUniqueOrThrow({ where: { id: completed.res.json.rideId } });
  const cancelledRide = await prisma.ride.findUniqueOrThrow({ where: { id: cancelled.res.json.rideId } });
  expect(lines[1]).toContain(`COMPLETED;${completedRide.id};R-${completedRide.ref};'=FORMULE;${(completedRide.priceCents / 100).toFixed(2)};${(completedRide.driverNetCents / 100).toFixed(2)};EUR`);
  expect(lines[2]).toContain(`CANCELLED_BY_PARTNER;${cancelledRide.id};R-${cancelledRide.ref};BK-1;${(cancelledRide.cancellationFeeCents / 100).toFixed(2)};${(cancelledRide.driverCompensationCents / 100).toFixed(2)};EUR`);
});

it("absorbe un rush de 100 courses et conserve les notifications et alertes attendues", async () => {
  const partner = await mkPartner(false);
  const drivers = [];
  for (let i = 0; i < 10; i++) drivers.push(await mkDriver());

  const durations = { quote: [] as number[], booking: [] as number[] };
  async function measure<T>(stage: keyof typeof durations, request: () => Promise<T>) {
    const start = performance.now();
    try { return await request(); } finally { durations[stage].push(performance.now() - start); }
  }
  const concurrency = Number(process.env.RUSH_CONCURRENCY ?? 10);
  expect(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 100).toBe(true);
  async function batches<T>(rows: T[], run: (row: T) => Promise<void>, size = 10) {
    for (let i = 0; i < rows.length; i += size) await Promise.all(rows.slice(i, i + size).map(run));
  }

  const start = Date.now();
  const slots = Array.from({ length: 100 }, (_, i) => i);
  const bookings: { index: number; id: string; rideId: string; ref: number }[] = [];
  await batches(slots, async (index) => {
    const token = partner.apiKey;
    const quote = await measure("quote", () => call("/v1/quotes", {
      token,
      body: {
        pickup: CDG, dropoff: PARIS,
        pickupAt: new Date(start + (48 + 6 * Math.floor(index / 10)) * 3600_000).toISOString(),
        category: index >= 85 && index < 95 ? "VAN" : "BERLINE",
        passengers: 2, flightNumber: "AF1234",
      },
    }));
    expect(quote.status).toBe(201);
    const body = { quoteId: quote.json.quoteId, externalReference: `RUSH-${index}`, passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000" } };
    const request = () => call("/v1/bookings", { token, headers: { "idempotency-key": `rush-${index}` }, body });
    const result = await measure("booking", request);
    expect(result.status).toBe(201);
    if (index % 10 === 0) expect((await request()).json.id).toBe(result.json.id);
    bookings[index] = { index, id: result.json.id, rideId: result.json.rideId, ref: result.json.ref };
  }, concurrency);
  const bookingElapsedMs = Date.now() - start;
  expect(await prisma.booking.count()).toBe(100);

  const offered = await Promise.all(drivers.map(async (driver) => (await call("/driver/offers", { token: driver.token })).json));
  const visibleOffers = await prisma.dispatchOffer.findMany({
    where: { id: { in: offered.flat().map((offer) => offer.offerId) } }, select: { rideId: true },
  });
  expect(new Set(visibleOffers.map((offer) => offer.rideId)).size).toBe(90);
  const withDriver = bookings.filter(({ index }) => index < 85 || index >= 95);
  await batches(withDriver, async ({ index, rideId }) => {
    const assignment = await call(`/admin/rides/${rideId}/assign`, await manualAssignment(prisma, rideId, drivers[index % drivers.length].id));
    expect(assignment.status, JSON.stringify(assignment.json)).toBe(201);
  });

  const email = app.get(EmailService);
  const oldProvider = email.provider;
  const sentEmails: string[] = [];
  email.provider = { send: async (message) => { sentEmails.push(message.subject); } };
  try {
    await batches(bookings.slice(0, 85), async ({ index, id, rideId }) => {
      const driver = drivers[index % drivers.length];
      if (index >= 60 && index < 75) {
        const result = await call(`/v1/bookings/${id}`, { token: partner.apiKey, method: "DELETE" });
        expect(result.status).toBe(200);
        return;
      }
      for (const action of ["en-route", "arrived"]) expect((await act(driver, rideId, action)).status).toBe(201);
      if (index < 60) {
        for (const action of ["start", "complete"]) expect((await act(driver, rideId, action)).status).toBe(201);
      } else {
        expect((await act(driver, rideId, "no-show")).status).toBe(409);
        const past = new Date(Date.now() - 40 * 60_000);
        await prisma.ride.update({ where: { id: rideId }, data: { pickupAt: past } });
        await prisma.rideEvent.updateMany({ where: { rideId, type: "ride.arrived" }, data: { createdAt: past } });
        expect((await act(driver, rideId, "no-show")).status).toBe(201);
      }
    });
  } finally {
    email.provider = oldProvider;
  }
  expect(sentEmails).toHaveLength(15);

  const incident = await call("/driver/incidents", { token: drivers[5].token, body: { kind: "DANGER", rideId: bookings[95].rideId } });
  expect(incident.status).toBe(201);
  const open = await call("/admin/incidents?status=OPEN", { admin: true });
  expect(open.json).toEqual([expect.objectContaining({ id: incident.json.id, urgent: true })]);
  expect((await call(`/admin/incidents/${incident.json.id}/ack`, { admin: true, body: {} })).status).toBe(201);
  expect((await call(`/admin/incidents/${incident.json.id}/close`, { admin: true, body: { resolution: "Assistance envoyée" } })).status).toBe(201);
  expect((await call("/admin/incidents?status=OPEN", { admin: true })).json).toHaveLength(0);

  for (const { rideId } of bookings.slice(95)) {
    expect((await call(`/admin/rides/${rideId}/flight`, { admin: true, body: { status: "CANCELLED" } })).status).toBe(201);
  }
  for (let round = 1; round <= DISPATCH.maxRounds + 1; round++) {
    await dispatch.sweep(new Date(start + round * 3600_000));
  }
  const alerts = await call("/admin/alerts", { admin: true });
  expect(alerts.status).toBe(200);
  const alertIds = (reason: string) => alerts.json.filter((a: { reason: string }) => a.reason === reason).map((a: { rideId: string }) => a.rideId).sort();
  expect(alertIds("NO_DRIVER")).toEqual(bookings.slice(85, 95).map((b) => b.rideId).sort());
  expect(alertIds("FLIGHT_CANCELLED")).toEqual(bookings.slice(95).map((b) => b.rideId).sort());

  const inboxes = await Promise.all(drivers.map(async (driver) => (await call("/driver/notifications", { token: driver.token })).json));
  const items = inboxes.flatMap((inbox) => inbox.items);
  expect(items.filter((n) => n.type === "ASSIGNED_BY_DISPATCH")).toHaveLength(90);
  expect(items.filter((n) => n.type === "RIDE_CANCELLED")).toHaveLength(15);
  expect(items.filter((n) => n.type === "FLIGHT_CANCELLED")).toHaveLength(5);
  expect(items.filter((n) => n.type === "INCIDENT_RECEIVED")).toHaveLength(1);
  expect(items.filter((n) => n.type === "INCIDENT_ACK")).toHaveLength(1);
  expect(items.filter((n) => n.type === "INCIDENT_CLOSED")).toHaveLength(1);
  for (const [i, driver] of drivers.entries()) {
    expect(inboxes[i].items.filter((n: { type: string }) => n.type === "ASSIGNED_BY_DISPATCH")).toHaveLength(withDriver.filter((b) => b.index % 10 === i).length);
    expect((await call("/driver/notifications/read", { token: driver.token, body: {} })).json.marked).toBe(inboxes[i].unread);
    expect((await call("/driver/notifications", { token: driver.token })).json.unread).toBe(0);
  }
  const statuses = await prisma.ride.groupBy({ by: ["status"], _count: true });
  expect(Object.fromEntries(statuses.map(({ status, _count }) => [status, _count]))).toEqual({
    COMPLETED: 60, CANCELLED_BY_PARTNER: 15, NO_SHOW: 10, DISPATCHING: 10, ASSIGNED: 5,
  });
  const p95 = (values: number[]) => Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]);
  console.info(JSON.stringify({ courses: 100, concurrency, bookingElapsedMs, quoteP95Ms: p95(durations.quote), bookingP95Ms: p95(durations.booking), scenarioElapsedMs: Date.now() - start }));
}, 90_000);
