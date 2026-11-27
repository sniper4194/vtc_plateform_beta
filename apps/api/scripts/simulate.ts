/**
 * Simulateur de partenaire (type Booking.com) : joue un parcours complet contre une API qui tourne.
 *   ADMIN_TOKEN=... API_URL=http://localhost:3000 pnpm -F @vtc/api simulate
 * Il crée un partenaire + 2 chauffeurs de démonstration, réserve un transfert CDG → Paris,
 * fait accepter la course, la déroule jusqu'à la fin et vérifie les webhooks reçus (signature comprise).
 */
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { signWebhook } from "../src/security";

const API = process.env.API_URL ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_TOKEN;
if (!ADMIN) throw new Error("ADMIN_TOKEN requis");
const run = Date.now().toString().slice(-6);

async function call(path: string, o: { token?: string; admin?: boolean; body?: unknown; method?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(API + path, {
    method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...(o.admin ? { "x-admin-token": ADMIN! } : {}),
      ...o.headers,
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  const t = await res.text();
  const json = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${t}`);
  return json;
}
const step = (m: string) => console.log(`\n▶ ${m}`);

async function main() {
  const received: { type: string; ok: boolean }[] = [];
  let secret = "";
  const hook = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = /t=(\d+),v1=([0-9a-f]+)/.exec(String(req.headers["x-signature"]));
      const ok = !!m && m[2] === signWebhook(secret, body, Number(m[1]));
      received.push({ type: JSON.parse(body).type, ok });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
  const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;

  step("Création du partenaire de test");
  const partner = await call("/admin/partners", { admin: true, body: { name: `Booking (simulateur ${run})`, webhookUrl: hookUrl } });
  secret = partner.webhookSecret;
  console.log(`  clé API : ${partner.apiKey.slice(0, 18)}…`);

  step("Onboarding de 2 chauffeurs (documents + validation)");
  const drivers = [] as { id: string; token: string; name: string }[];
  for (const [i, pos] of [[1, { lat: 49.0, lng: 2.5 }], [2, { lat: 48.86, lng: 2.35 }]] as const) {
    const d = await call("/admin/drivers", {
      admin: true,
      body: { firstName: `Démo${i}`, lastName: "Chauffeur", phone: `+3367${run}0${i}`, email: `demo${run}${i}@example.com`,
        vehicle: { plate: `DM-${run.slice(0, 3)}-${i}${i}`, make: "Toyota", model: "Camry", category: "BERLINE" } },
    });
    const { token } = await call("/driver/login", { body: { phone: d.phone, code: process.env.DRIVER_DEV_OTP ?? "000000" } });
    for (const type of ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID", "AIRPORT_BADGE"]) {
      const doc = await call("/driver/documents", { token, body: { type, storageKey: `demo/${d.id}/${type}` } });
      await call(`/admin/documents/${doc.id}/review`, { admin: true, body: { status: "APPROVED" } });
    }
    await call(`/admin/drivers/${d.id}/approve`, { admin: true, body: {} });
    await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
    await call("/driver/location", { token, body: pos });
    drivers.push({ id: d.id, token, name: d.firstName });
  }
  console.log(`  ${drivers.map((d) => d.name).join(", ")} actifs et disponibles`);

  step("Devis CDG → Paris (Berline)");
  const pickupAt = new Date(Date.now() + 3 * 86400_000).toISOString();
  const quote = await call("/v1/quotes", {
    token: partner.apiKey,
    body: {
      pickup: { address: "Aéroport Paris-Charles de Gaulle T2", lat: 49.0097, lng: 2.5479 },
      dropoff: { address: "10 rue de Rivoli, 75004 Paris", lat: 48.8566, lng: 2.3522 },
      pickupAt, category: "BERLINE", passengers: 2, luggage: 2, flightNumber: "AF1234",
    },
  });
  console.log(`  prix fixe : ${quote.total} € (forfait aéroport : ${quote.flatRate})`);

  step("Réservation (idempotente)");
  const body = { quoteId: quote.quoteId, externalReference: `BK-${run}`, passenger: { firstName: "Ana", lastName: "Silva", phone: "+351912345678", language: "pt" } };
  const booking = await call("/v1/bookings", { token: partner.apiKey, headers: { "idempotency-key": `sim-${run}` }, body });
  const replay = await call("/v1/bookings", { token: partner.apiKey, headers: { "idempotency-key": `sim-${run}` }, body });
  console.log(`  réservation ${booking.id} — statut ${booking.status} ; rejeu idempotent : ${replay.id === booking.id ? "OK" : "ÉCHEC"}`);

  step("Bourse : les chauffeurs voient la course");
  const offers = await Promise.all(drivers.map((d) => call("/driver/offers", { token: d.token })));
  offers.forEach((o, i) => console.log(`  ${drivers[i].name} : ${o.length} offre(s), net ${o[0] ? o[0].netCents / 100 : "-"} €, ${o[0]?.secondsLeft}s restantes`));

  step("Acceptation simultanée par les deux chauffeurs");
  const results = await Promise.allSettled(drivers.map((d, i) => call(`/driver/offers/${offers[i][0].offerId}/accept`, { token: d.token, body: {} })));
  const winnerIdx = results.findIndex((r) => r.status === "fulfilled");
  console.log(`  gagnant : ${drivers[winnerIdx].name} ; l'autre a été refusé (409) : ${results.filter((r) => r.status === "rejected").length === 1}`);
  const winner = drivers[winnerIdx];

  step("Exécution de la course");
  const rides = await call("/driver/rides", { token: winner.token });
  for (const a of ["en-route", "arrived", "start", "complete"]) {
    await call(`/driver/rides/${rides[0].rideId}/${a}`, { token: winner.token, body: {} });
    console.log(`  ${a}`);
  }

  step("Livraison des webhooks");
  await call("/admin/run-workers", { admin: true, body: {} });
  console.log("  " + received.map((r) => `${r.type}${r.ok ? " ✓" : " ✗(signature)"}`).join("\n  "));
  const expected = ["booking.confirmed", "driver.assigned", "driver.en_route", "driver.arrived", "ride.started", "ride.completed"];
  const good = received.length === expected.length && received.every((r, i) => r.ok && r.type === expected[i]);
  const final = await call(`/v1/bookings/${booking.id}`, { token: partner.apiKey });
  console.log(`\nStatut final : ${final.status}`);
  hook.close();
  if (!good || final.status !== "COMPLETED") {
    console.error("✗ Parcours incomplet");
    process.exit(1);
  }
  console.log("✓ Parcours complet validé");
}
main().catch((e) => { console.error(e); process.exit(1); });
