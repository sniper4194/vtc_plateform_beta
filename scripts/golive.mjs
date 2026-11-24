// Essai en conditions réelles d'un serveur CliCab en ligne : vrai SMS, vrai téléphone.
// À lancer depuis VOTRE PC (Node 20+, aucune installation) :
//   node scripts/golive.mjs https://api.clicab.fr
// Variables : ADMIN_TOKEN (le jeton de service du serveur), GOLIVE_PHONE (votre numéro, ex. 0612345678),
//             GOLIVE_ADMIN_EMAIL, GOLIVE_ADMIN_PASSWORD (le compte administrateur à créer).
// Ce que le script fait : vérifie le serveur, crée votre compte administrateur, un partenaire de test, un chauffeur à votre numéro,
// vous envoie un VRAI SMS (vous tapez le code), valide ses documents (références de test), puis crée deux missions à prendre.
import { createInterface } from "node:readline/promises";

const API = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(API)) { console.error("Usage : node scripts/golive.mjs https://api.clicab.fr"); process.exit(1); }
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Variable manquante : ${k}`); process.exit(1); } return v; };
const ADMIN_TOKEN = need("ADMIN_TOKEN"), PHONE = need("GOLIVE_PHONE"), EMAIL = need("GOLIVE_ADMIN_EMAIL"), PASSWORD = need("GOLIVE_ADMIN_PASSWORD");
// Toute erreur inattendue s'affiche en clair (et non en trace technique), avec la piste la plus probable.
process.on("uncaughtException", (e) => {
  console.error(`\n✗ ${e.message}`);
  if (e.status === 401 || e.status === 403) console.error("  → le jeton ADMIN_TOKEN ne correspond pas à celui du serveur (variable du projet dans hPanel), ou le compte n'a pas les droits.");
  process.exit(1);
});
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ok = (m) => console.log(`✔ ${m}`);

// Le jeton de service n'est envoyé qu'aux routes d'administration : jamais à /health ou /ready (il finirait dans les journaux du proxy en cas de panne).
async function call(path, { method, token, body, headers, anonymous } = {}) {
  const res = await fetch(API + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : anonymous ? {} : { "x-admin-token": ADMIN_TOKEN }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(`${path} → ${res.status} ${JSON.stringify(json)}`), { status: res.status, json });
  return json;
}
const inDays = (d) => new Date(Date.now() + d * 86400_000).toISOString();

// 1. Serveur joignable et base connectée
const health = await call("/health", { anonymous: true }).catch((e) => { console.error(`✗ Serveur injoignable : ${e.message}`); process.exit(1); });
ok(`serveur joignable (${JSON.stringify(health)})`);
const ready = await call("/ready", { anonymous: true }).catch(() => null);
ok(ready ? "base de données connectée" : "⚠ /ready ne répond pas : vérifiez la base de données");

// 2. Compte administrateur
try { await call("/admin/users", { body: { email: EMAIL, name: "Administrateur", password: PASSWORD, role: "ADMIN" } }); ok(`compte administrateur créé : ${EMAIL}`); }
catch (e) { if (e.status === 409) ok(`compte administrateur déjà présent : ${EMAIL}`); else throw e; }

// 3. Partenaire de test
const partner = await call("/admin/partners", { body: { name: "Partenaire de test" } });
ok("partenaire de test créé");

// 4. Chauffeur à votre numéro (repris s'il existe déjà : le script peut être relancé après un échec)
const stamp = String(Date.now()).slice(-5);
const e164 = (p) => { const d = p.replace(/[\s.()-]/g, ""); return d.startsWith("+") ? d : d.startsWith("00") ? "+" + d.slice(2) : /^0\d{9}$/.test(d) ? "+33" + d.slice(1) : d; };
let driver = (await call("/admin/drivers")).find((d) => d.phone === e164(PHONE));
if (driver) ok(`chauffeur déjà présent pour ${driver.phone} : on le reprend`);
else {
  try {
    driver = await call("/admin/drivers", { body: { firstName: "Testeur", lastName: "CliCab", phone: PHONE, email: `testeur${stamp}@example.com`, vehicle: { plate: `TS-${stamp.slice(0, 3)}-AB`, make: "Toyota", model: "Camry", category: "BERLINE" } } });
    ok(`chauffeur créé pour ${driver.phone}`);
  } catch (e) { console.error(`✗ Création du chauffeur : ${e.message}`); process.exit(1); }
}

// 5. VRAI SMS : le chauffeur se connecte comme dans l'application
console.log(`\n▶ Envoi d'un SMS au ${driver.phone}…`);
try { await call("/driver/otp", { body: { phone: driver.phone } }); }
catch (e) { console.error(`✗ L'envoi du SMS a échoué : ${e.message}\n  → vérifiez SMS_PROVIDER et les identifiants (Twilio / OVHcloud) dans les variables du projet, puis les journaux de l'API.`); process.exit(1); }
const code = (await rl.question("  Code reçu par SMS (6 chiffres) : ")).trim();
const login = await call("/driver/login", { body: { phone: driver.phone, code } }).catch((e) => { console.error(`✗ Connexion refusée : ${e.message}`); process.exit(1); });
ok("connexion par SMS réussie : le SMS fonctionne");

// 6. Documents (références de test) validés par l'administrateur
for (const type of ["VTC_CARD", "DRIVING_LICENSE", "INSURANCE", "ID"]) {
  const d = await call("/driver/documents", { token: login.token, body: { type, storageKey: `golive/${type}` } });
  await call(`/admin/documents/${d.id}/review`, { body: { status: "APPROVED" } });
}
if (driver.status !== "ACTIVE") await call(`/admin/drivers/${driver.id}/approve`, { body: {} }).catch((e) => { console.error(`✗ Validation du chauffeur : ${e.message}`); process.exit(1); });
ok("chauffeur validé (documents de test)");

// 7. Deux missions à prendre
const CDG = { address: "Aéroport Charles de Gaulle T2", lat: 49.0097, lng: 2.5479 }, PARIS = { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 };
for (let i = 0; i < 2; i++) {
  const q = await call("/v1/quotes", { token: partner.apiKey, body: { pickup: CDG, dropoff: PARIS, pickupAt: inDays(3 + i), category: "BERLINE", passengers: 2, luggage: 1 } });
  await call("/v1/bookings", { token: partner.apiKey, headers: { "idempotency-key": `golive-${stamp}-${i}` }, body: { quoteId: q.quoteId, externalReference: `GOLIVE-${stamp}-${i}`, passenger: { firstName: "Voyageur", lastName: "Test", phone: "+33600000099", language: "fr" } } });
}
ok("deux missions créées");

console.log(`
══════════════════════════════════════════════════════════════
 Essai prêt.
 1. Application chauffeur : serveur ${API}, téléphone ${driver.phone}, code reçu par SMS.
 2. Radar : prenez une mission, mettez-vous « sur place », testez la photo-preuve (dehors, avec le GPS).
 3. Back-office : ${API.includes("//api.") ? API.replace("//api.", "//admin.") : "voir l'adresse de votre back-office"}  e-mail ${EMAIL}
══════════════════════════════════════════════════════════════`);
rl.close();
