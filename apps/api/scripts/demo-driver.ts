/**
 * Prépare un chauffeur de démonstration et deux missions à prendre, pour essayer l'application (Expo Go, simulateur, APK).
 *   pnpm -F @vtc/api demo:driver          (l'API doit tourner : pnpm -F @vtc/api dev:demo)
 * Le chauffeur est validé et en ligne. Connexion dans l'application : numéro affiché + code 000000.
 * Relancer le script réutilise le même chauffeur et ajoute deux nouvelles missions.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost:3000";
// Jeton de service de `pnpm -F @vtc/api dev:demo`. On ne lit PAS ADMIN_TOKEN : charger Prisma lit apps/api/.env, dont la valeur d'exemple écraserait celle-ci.
const ADMIN = process.env.DEMO_ADMIN_TOKEN ?? "dev-admin-token-dev-admin-token";
const CODE = "000000";
const PHONE = "+33600000001";

async function call(path: string, o: { token?: string; admin?: boolean; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(API + path, {
    method: o.body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.admin ? { "x-admin-token": ADMIN } : {}), ...o.headers },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  const t = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${path} → ${res.status} ${t}`), { status: res.status });
  return t ? JSON.parse(t) : null;
}

/** Clé d'accès fixe de la société de démonstration (la clé réelle d'une société n'est affichée qu'une fois ; ici elle est connue pour pouvoir se connecter à chaque lancement). */
export const DEMO_COMPANY_KEY = "cmp_demo_clicab_cle_de_demonstration_2026";
const COMPANY_PHONE = "+33600000002";

/** Société de démonstration + un chauffeur rattaché (créé par l'API société, validé et en ligne). */
async function demoCompany(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const accessKeyHash = createHash("sha256").update(DEMO_COMPANY_KEY).digest("hex");
    await prisma.company.upsert({
      where: { siret: "12345678901234" },
      create: { name: "Taxis Démo SARL", siret: "12345678901234", vtcRegistry: "EVTC075123456", accessKeyHash, accessKeyPrefix: DEMO_COMPANY_KEY.slice(0, 12) },
      update: { accessKeyHash, accessKeyPrefix: DEMO_COMPANY_KEY.slice(0, 12), active: true },
    });
  } finally { await prisma.$disconnect(); }
  const mine = (await call("/company/drivers", { token: DEMO_COMPANY_KEY })) as any[];
  let driver = mine.find((d) => d.phone === COMPANY_PHONE);
  if (!driver) driver = await call("/company/drivers", { token: DEMO_COMPANY_KEY, body: { firstName: "Camille", lastName: "Société", phone: COMPANY_PHONE, email: "karim.societe@example.com", vehicle: { plate: "DE-002-MO", make: "Mercedes", model: "Classe E", category: "BUSINESS" } } });
  const { token } = await call("/driver/login", { body: { phone: COMPANY_PHONE, code: CODE } });
  const docs = ((await call("/driver/documents", { token }).catch(() => [])) as any[]).map((d) => d.type);
  for (const type of ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"]) {
    if (docs.includes(type)) continue;
    const doc = await call("/driver/documents", { token, body: { type, storageKey: `demo/${type}` } });
    await call(`/admin/documents/${doc.id}/review`, { admin: true, body: { status: "APPROVED" } });
  }
  await call(`/admin/drivers/${driver.id}/approve`, { admin: true, body: {} }).catch(() => undefined);
  await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
  await call("/driver/location", { token, body: { lat: 48.88, lng: 2.34 } });
}

async function main() {
  // Garde-fou : ce script crée des comptes de démonstration avec des codes et une clé connus. Jamais contre un vrai serveur.
  const host = new URL(API).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env.ALLOW_REMOTE_DEMO !== "1") {
    throw new Error(`Refusé : ${host} n'est pas un serveur local. Ce script crée des comptes de démonstration (code 000000, clé connue) et ne doit jamais viser un serveur réel.`);
  }
  try { await call("/health"); } catch { throw new Error(`L'API ne répond pas sur ${API}. Lancez-la d'abord : pnpm -F @vtc/api dev:demo`); }

  // Chauffeur déjà créé lors d'un lancement précédent ? On le réutilise (évite aussi une erreur de doublon dans les journaux de l'API).
  const existing = (await call("/admin/drivers", { admin: true })).find((d: any) => d.phone === PHONE);
  const driver: { id: string } = existing ?? await call("/admin/drivers", { admin: true, body: { firstName: "Démo", lastName: "Chauffeur", phone: PHONE, email: "demo.chauffeur@example.com", vehicle: { plate: "DE-001-MO", make: "Toyota", model: "Camry", category: "BERLINE" } } });

  const { token } = await call("/driver/login", { body: { phone: PHONE, code: CODE } });
  const docs = await call("/driver/documents", { token }).catch(() => []);
  const have = new Set((docs as any[]).map((d) => d.type));
  for (const type of ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"]) {
    if (have.has(type)) continue;
    const doc = await call("/driver/documents", { token, body: { type, storageKey: `demo/${type}` } });
    await call(`/admin/documents/${doc.id}/review`, { admin: true, body: { status: "APPROVED" } });
  }
  await call(`/admin/drivers/${driver.id}/approve`, { admin: true, body: {} }).catch((e) => { if (e.status !== 409 || !/déjà/i.test(e.message)) console.log(`  (validation : ${e.message.slice(0, 160)})`); });
  await call("/driver/availability", { token, body: { availability: "AVAILABLE" } });
  await call("/driver/location", { token, body: { lat: 48.86, lng: 2.35 } });

  const partner = await call("/admin/partners", { admin: true, body: { name: `Agence démo ${Date.now().toString().slice(-4)}` } });
  const trips = [
    { days: 2, pickup: { address: "Aéroport Charles de Gaulle T2", lat: 49.0097, lng: 2.5479 }, dropoff: { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 }, flightNumber: "AF1234" },
    { days: 3, pickup: { address: "Gare du Nord, Paris", lat: 48.8809, lng: 2.3553 }, dropoff: { address: "Aéroport d'Orly", lat: 48.7262, lng: 2.3652 } },
  ];
  const links: string[] = [];
  for (const [i, t] of trips.entries()) {
    const q = await call("/v1/quotes", { token: partner.apiKey, body: { pickup: t.pickup, dropoff: t.dropoff, pickupAt: new Date(Date.now() + t.days * 86400_000).toISOString(), category: "BERLINE", passengers: 2, luggage: 1, ...(t.flightNumber ? { flightNumber: t.flightNumber } : {}) } });
    const b = await call("/v1/bookings", { token: partner.apiKey, headers: { "idempotency-key": `demo-${Date.now()}-${i}` }, body: { quoteId: q.quoteId, externalReference: `DEMO-${i + 1}`, passenger: { firstName: "Ana", lastName: "Silva", phone: "+351912345678", language: "fr" } } });
    if (b.trackingUrl) links.push(b.trackingUrl);
  }

  await demoCompany();

  console.log(`
✓ Chauffeur de démonstration prêt
  Numéro  : ${PHONE}   (saisir « 06 00 00 00 01 »)
  Code    : ${CODE}
  Missions: 2 à prendre dans l'onglet Radar
  Société de démonstration « Taxis Démo SARL » : http://localhost:3001/societe
     clé d'accès : ${DEMO_COMPANY_KEY}   (chauffeur rattaché : +33600000002, code ${CODE})
${links.length ? "  Lien de suivi voyageur (page web, port 3002) :\n  " + links.join("\n  ") + "\n" : ""}`);
}

main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
