/**
 * Prépare un chauffeur de démonstration et deux missions à prendre, pour essayer l'application (Expo Go, simulateur, APK).
 *   pnpm -F @vtc/api demo:driver          (l'API doit tourner : pnpm -F @vtc/api dev:demo)
 * Le chauffeur est validé et en ligne. Connexion dans l'application : numéro affiché + code 000000.
 * Relancer le script réutilise le même chauffeur et ajoute deux nouvelles missions.
 */
const API = process.env.API_URL ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_TOKEN ?? "dev-admin-token-dev-admin-token";
const CODE = process.env.DRIVER_DEV_OTP ?? "000000";
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

async function main() {
  try { await call("/health"); } catch { throw new Error(`L'API ne répond pas sur ${API}. Lancez-la d'abord : pnpm -F @vtc/api dev:demo`); }

  let driver: { id: string } | undefined;
  try {
    driver = await call("/admin/drivers", { admin: true, body: { firstName: "Démo", lastName: "Chauffeur", phone: PHONE, email: "demo.chauffeur@example.com", vehicle: { plate: "DE-001-MO", make: "Toyota", model: "Camry", category: "BERLINE" } } });
  } catch {
    const list = await call("/admin/drivers", { admin: true });
    driver = list.find((d: any) => d.phone === PHONE);
    if (!driver) throw new Error("Impossible de créer ni de retrouver le chauffeur de démonstration");
  }

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

  console.log(`
✓ Chauffeur de démonstration prêt
  Numéro  : ${PHONE}   (saisir « 06 00 00 00 01 »)
  Code    : ${CODE}
  Missions: 2 à prendre dans l'onglet Radar
${links.length ? "  Lien de suivi voyageur (page web, port 3002) :\n  " + links.join("\n  ") + "\n" : ""}`);
}

main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
