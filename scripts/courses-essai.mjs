// Crée des courses d'ESSAI sur un serveur CliCab (vrai serveur ou démo), pour tester l'application chauffeur.
// À lancer depuis votre PC (Node 20+) :   node scripts/courses-essai.mjs https://api.clicab.fr
// Variables : ADMIN_TOKEN (jeton de service du serveur), GOLIVE_PHONE (numéro du chauffeur de test), COURSES (nombre, 10 par défaut).
// Les courses sont distribuées par le Radar. Toute attribution manuelle passe par le back-office après appel et accord.
// Voyageurs fictifs, téléphone fictif : aucun SMS n'est envoyé aux voyageurs (partenaire « sans envoi »).
const API = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(API)) { console.error("Usage : node scripts/courses-essai.mjs https://api.clicab.fr"); process.exit(1); }
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Variable manquante : ${k}`); process.exit(1); } return v; };
const ADMIN_TOKEN = need("ADMIN_TOKEN"), PHONE = need("GOLIVE_PHONE"), N = Math.min(30, Math.max(1, Number(process.env.COURSES) || 10));

async function call(path, { token, body, headers } = {}) {
  const res = await fetch(API + path, {
    method: body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : { "x-admin-token": ADMIN_TOKEN }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${json?.message ?? text}`);
  return json;
}

const P = {
  cdg2: { address: "Aéroport Charles de Gaulle T2", lat: 49.0097, lng: 2.5479 },
  cdg1: { address: "Aéroport Charles de Gaulle T1", lat: 49.0147, lng: 2.542 },
  ory: { address: "Aéroport d'Orly", lat: 48.7262, lng: 2.3652 },
  lyon: { address: "Gare de Lyon, Paris", lat: 48.8443, lng: 2.3744 },
  nord: { address: "Gare du Nord, Paris", lat: 48.8809, lng: 2.3553 },
  rivoli: { address: "10 rue de Rivoli, Paris", lat: 48.8566, lng: 2.3522 },
  defense: { address: "La Défense, Puteaux", lat: 48.8918, lng: 2.2389 },
  opera: { address: "Place de l'Opéra, Paris", lat: 48.8708, lng: 2.3318 },
  bastille: { address: "Place de la Bastille, Paris", lat: 48.8532, lng: 2.3691 },
  vincennes: { address: "Château de Vincennes", lat: 48.8427, lng: 2.4357 },
};
// Prénoms et noms variés ; quelques vols et langues étrangères pour tester l'accueil traduit.
// Pas de besoins particuliers : le véhicule de test n'est pas équipé, la course ne lui serait jamais proposée.
const PAX = [
  ["Ingrid", "Larsen", "en"], ["Mateo", "Rossi", "it"], ["Aïcha", "Diallo", "fr"], ["Kenji", "Watanabe", "ja"], ["Olivia", "Brown", "en"],
  ["Lucas", "Martin", "fr"], ["Sofia", "García", "es"], ["Hamza", "Benali", "fr"], ["Anna", "Kowalska", "pl"], ["Yusuf", "Demir", "tr"],
  ["Chloé", "Lefèvre", "fr"], ["Noah", "Schmidt", "de"],
];
const TRIPS = [
  [P.cdg2, P.rivoli, "AF1234"], [P.ory, P.lyon, "TO4567"], [P.nord, P.defense], [P.opera, P.cdg1], [P.cdg1, P.bastille, "BA306"],
  [P.lyon, P.ory], [P.rivoli, P.vincennes], [P.ory, P.opera, "IB3402"], [P.defense, P.cdg2], [P.bastille, P.nord],
];
// Les 3 premières dans 20 min, 1 h 30 et 2 h 40 (« sur place » puis client absent testables vite, sans se chevaucher), les autres sur 3 jours.
const when = (i) => new Date(Date.now() + (i < 3 ? (20 + i * 70) * 60_000 : (2 + i * 6) * 3600_000)).toISOString();

const drivers = await call("/admin/drivers");
const e164 = (p) => { const d = p.replace(/[\s.()-]/g, ""); return d.startsWith("+") ? d : d.startsWith("00") ? "+" + d.slice(2) : /^0\d{9}$/.test(d) ? "+33" + d.slice(1) : d; };
const driver = drivers.find((d) => d.phone === e164(PHONE));
if (!driver) { console.error(`✗ Aucun chauffeur avec le numéro ${PHONE} : lancez d'abord scripts/golive.mjs`); process.exit(1); }
const partner = await call("/admin/partners", { body: { name: `Essais ${new Date().toLocaleDateString("fr-FR")}`, notifyPassenger: false } });
console.log(`✔ partenaire d'essai créé ; chauffeur : ${driver.firstName} ${driver.lastName} (${driver.phone})`);

const stamp = Date.now().toString(36);
for (let i = 0; i < N; i++) {
  const [from, to, flight] = TRIPS[i % TRIPS.length];
  const [first, last, lang] = PAX[i % PAX.length];
  const q = await call("/v1/quotes", { token: partner.apiKey, body: { pickup: from, dropoff: to, pickupAt: when(i), category: "BERLINE", passengers: 1 + (i % 3), luggage: i % 4, ...(flight ? { flightNumber: flight } : {}) } });
  const b = await call("/v1/bookings", {
    token: partner.apiKey, headers: { "idempotency-key": `essai-${stamp}-${i}` },
    body: { quoteId: q.quoteId, externalReference: `ESSAI-${i + 1}`, passenger: { firstName: first, lastName: last, phone: "+33600000099", language: lang } },
  });
  console.log(`✔ ${b.reference} · ${new Date(when(i)).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${from.address} → ${to.address} · ${first} ${last} · sur le Radar`);
}
console.log(`\n${N} courses d'essai créées. La première démarre dans 20 minutes.`);
