import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { BookingsService, cancellationFeeCents } from "./bookings.service";
import { DISPATCH, DispatchService } from "./dispatch.service";
import { signWebhook } from "./security";
import { WebhooksService } from "./webhooks.service";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;
let dispatch: DispatchService;
let webhooks: WebhooksService;

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

async function mkBooking(p: { apiKey: string }, over: Record<string, unknown> = {}, key = `k-${Math.random()}`) {
  const q = await call("/v1/quotes", {
    token: p.apiKey,
    body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3), category: "BERLINE", passengers: 2, luggage: 1, flightNumber: "AF1234", ...over },
  });
  expect(q.status).toBe(201);
  const b = await call("/v1/bookings", {
    token: p.apiKey, headers: { "idempotency-key": key },
    body: { quoteId: q.json.quoteId, externalReference: "BK-1", passenger: { firstName: "Ana", lastName: "Silva", phone: "+351900000000", language: "pt" } },
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
    'TRUNCATE "WebhookDelivery","Quote","RideEvent","DispatchOffer","Rating","Ride","Booking","ApiKey","Partner","Document","Vehicle","Payout","Driver","Company","AuditLog" CASCADE',
  );
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
    expect((await call(`/admin/rides/${res.json.rideId}/assign`, { admin: true, body: { driverId: d.id } })).status).toBe(201);
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
    expect((await call(`/admin/rides/${res.json.rideId}/assign`, { admin: true, body: { driverId: pending.id } })).status).toBe(409);
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
