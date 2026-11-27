/**
 * Import de courses depuis un fichier CSV envoyé par un donneur d'ordre (plateformes de transfert, agences…).
 * Les formats exacts de chaque plateforme ne sont PAS connus (aucune documentation publique trouvée) : la lecture repose
 * sur une correspondance « colonne du fichier → champ CliCab », devinée d'après les titres puis corrigeable par le dispatcheur
 * et mémorisée pour chaque donneur d'ordre. Rien ne part au Radar sans un clic humain.
 */

export const IMPORT_FIELDS = [
  "reference", "pickupDateTime", "pickupDate", "pickupTime", "pickupAddress", "dropoffAddress",
  "pickupLat", "pickupLng", "dropoffLat", "dropoffLng",
  "passengerName", "passengerFirstName", "passengerLastName", "passengerPhone", "passengerEmail",
  "flightNumber", "passengers", "luggage", "price", "category", "notes", "signText",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Partial<Record<ImportField, number>>; // champ → index de colonne

export const FIELD_LABEL: Record<ImportField, string> = {
  reference: "Référence de la course", pickupDateTime: "Date et heure de prise en charge", pickupDate: "Date de prise en charge",
  pickupTime: "Heure de prise en charge", pickupAddress: "Adresse de départ", dropoffAddress: "Adresse d'arrivée",
  pickupLat: "Latitude départ", pickupLng: "Longitude départ", dropoffLat: "Latitude arrivée", dropoffLng: "Longitude arrivée",
  passengerName: "Nom complet du voyageur", passengerFirstName: "Prénom du voyageur", passengerLastName: "Nom du voyageur",
  passengerPhone: "Téléphone du voyageur", passengerEmail: "E-mail du voyageur", flightNumber: "Numéro de vol",
  passengers: "Nombre de passagers", luggage: "Nombre de bagages", price: "Prix (payé par le donneur d'ordre)",
  category: "Catégorie de véhicule", notes: "Remarques", signText: "Texte de la pancarte",
};

/** Mots attendus dans les titres de colonnes (français et anglais), comparés sans accents ni ponctuation. */
const SYNONYMS: Record<ImportField, string[]> = {
  reference: ["reference", "ref", "bookingid", "bookingreference", "bookingref", "booking", "ridereference", "rideid", "id", "numero", "numeroreservation", "confirmation", "jobid", "transferid"],
  pickupDateTime: ["pickupdatetime", "pickuptime", "datetime", "dateheure", "pickupat", "dateetheure", "datetimeofpickup", "pickupdateandtime"],
  pickupDate: ["date", "pickupdate", "datedepriseencharge", "datepriseencharge", "datedepart", "traveldate", "servicedate"],
  pickupTime: ["heure", "time", "heuredepriseencharge", "heurepriseencharge", "heuredepart", "hour"],
  pickupAddress: ["pickup", "pickupaddress", "pickuplocation", "from", "depart", "adressededepart", "adressedepart", "lieudepriseencharge", "origin", "fromaddress", "start"],
  dropoffAddress: ["dropoff", "dropoffaddress", "dropofflocation", "to", "arrivee", "destination", "adressedarrivee", "adressearrivee", "toaddress", "end"],
  pickupLat: ["pickuplat", "pickuplatitude", "fromlat", "latdepart"],
  pickupLng: ["pickuplng", "pickuplon", "pickuplongitude", "fromlng", "fromlon", "lngdepart", "londepart"],
  dropoffLat: ["dropofflat", "dropofflatitude", "tolat", "latarrivee"],
  dropoffLng: ["dropofflng", "dropofflon", "dropofflongitude", "tolng", "tolon", "lngarrivee", "lonarrivee"],
  passengerName: ["passenger", "passengername", "name", "client", "nomclient", "voyageur", "customer", "customername", "leadpassenger", "guest", "guestname"],
  passengerFirstName: ["firstname", "prenom", "passengerfirstname", "givenname"],
  passengerLastName: ["lastname", "nom", "passengerlastname", "surname", "familyname"],
  passengerPhone: ["phone", "telephone", "tel", "mobile", "passengerphone", "phonenumber", "contactnumber", "gsm"],
  passengerEmail: ["email", "mail", "courriel", "passengeremail"],
  flightNumber: ["flight", "flightnumber", "vol", "numerodevol", "flightno", "trainorflight", "flighttrain"],
  passengers: ["passengers", "pax", "passagers", "nbpassagers", "nombredepassagers", "adults", "persons"],
  luggage: ["luggage", "bagages", "bags", "suitcases", "valises", "nbbagages"],
  price: ["price", "prix", "amount", "montant", "fare", "total", "tarif", "cost", "netprice", "supplierprice", "payout"],
  category: ["category", "categorie", "vehicle", "vehicule", "vehicletype", "cartype", "class", "typedevehicule"],
  notes: ["notes", "note", "remarks", "remarques", "comments", "commentaires", "instructions", "specialrequests"],
  signText: ["sign", "pancarte", "meetandgreet", "nameboard", "signboard", "signtext"],
};

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Lit un CSV : séparateur deviné (; , tabulation), guillemets, retours chariot Windows, marque BOM. */
export function parseCsv(text: string): { headers: string[]; rows: string[][]; delimiter: string } {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/)[0] ?? "";
  const delimiter = [";", ",", "\t"].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  const [headers = [], ...rows] = out;
  return { headers: headers.map((h) => h.trim()), rows, delimiter };
}

/** Correspondance devinée d'après les titres : correspondance exacte d'abord, puis titre qui contient le mot. */
export function guessMapping(headers: string[]): Mapping {
  const n = headers.map(norm);
  const used = new Set<number>();
  const m: Mapping = {};
  for (const pass of ["exact", "contains"] as const) {
    for (const f of IMPORT_FIELDS) {
      if (m[f] !== undefined) continue;
      const idx = n.findIndex((h, i) => !used.has(i) && SYNONYMS[f].some((s) => (pass === "exact" ? h === s : s.length >= 4 && h.includes(s))));
      if (idx >= 0) { m[f] = idx; used.add(idx); }
    }
  }
  // Une seule colonne « date » qui contient aussi l'heure : on la traite comme date et heure.
  return m;
}

const TZ = "Europe/Paris";
function parisOffsetMin(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")!.value;
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(p);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
/** Heure locale de Paris → instant UTC (heure d'été comprise). */
export function parisToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - parisOffsetMin(new Date(guess)) * 60_000;
  return new Date(guess - parisOffsetMin(new Date(first)) * 60_000);
}

/**
 * Date et heure d'un fichier, lues comme heure de Paris : « 2026-12-01 14:30 », « 01/12/2026 14h30 », « 1.12.2026 », ISO avec fuseau…
 * Format jour/mois (européen) pour les dates avec barres obliques : une date ambiguë est lue à la française.
 */
export function parseDateTime(dateText: string, timeText = ""): Date | null {
  const s = `${dateText} ${timeText}`.trim();
  if (!s) return null;
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(dateText.trim())) {
    const d = new Date(dateText.trim());
    return isNaN(d.getTime()) ? null : d;
  }
  let y: number, mo: number, d: number;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(s))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  } else return null;
  const rest = s.slice((m.index ?? 0) + m[0].length);
  const t = /(\d{1,2})\s*[:hH]\s*(\d{2})?\s*(am|pm|AM|PM)?/.exec(rest);
  let h = t ? Number(t[1]) : NaN, mi = t && t[2] ? Number(t[2]) : 0;
  if (t?.[3]) { const pm = t[3].toLowerCase() === "pm"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (!t || h > 23 || mi > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const out = parisToUtc(y, mo, d, h, mi);
  return isNaN(out.getTime()) ? null : out;
}

/** « 55,00 € », « EUR 55.50 », « 1 234,5 » → centimes. */
export function parsePriceCents(text: string): number | null {
  const s = text.replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  const decimals = lastSep >= 0 && s.length - lastSep - 1 <= 2 ? s.slice(lastSep + 1) : "";
  const intPart = (decimals ? s.slice(0, lastSep) : s).replace(/[,.]/g, "");
  const v = Number(`${intPart}.${decimals || "0"}`);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

/** Catégorie du fichier → catégorie CliCab (par défaut : berline). */
export function parseCategory(text: string): "BERLINE" | "BUSINESS" | "VAN" | "GREEN" {
  const s = norm(text);
  if (/van|minivan|minibus|monospace|mpv|vito|vclass|7seat|8seat|7places|8places/.test(s)) return "VAN";
  if (/business|premium|executive|first|luxe|luxury|eclass|sclass|prestige/.test(s)) return "BUSINESS";
  if (/green|electric|electrique|ev|eco/.test(s)) return "GREEN";
  return "BERLINE";
}

export const normalizeFlight = (s: string) => {
  const f = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2}\d{1,4}$/.test(f) ? f : null;
};

export interface Draft {
  reference: string | null;
  pickupAt: Date | null;
  pickupAddress: string; dropoffAddress: string;
  pickupCoords: { lat: number; lng: number } | null; dropoffCoords: { lat: number; lng: number } | null;
  firstName: string; lastName: string; phone: string; email: string | null;
  flightNumber: string | null; passengers: number; luggage: number; priceCents: number | null;
  category: "BERLINE" | "BUSINESS" | "VAN" | "GREEN"; notes: string | null; signText: string | null;
  errors: string[];
}

const num = (s: string | undefined) => (s && s.trim() !== "" && Number.isFinite(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : null);
const coords = (lat: number | null, lng: number | null) => (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);

/** Une ligne du fichier → brouillon de course, avec la liste des problèmes à corriger (aucune supposition silencieuse). */
export function toDraft(row: string[], m: Mapping, now = new Date()): Draft {
  const get = (f: ImportField) => (m[f] !== undefined ? (row[m[f]!] ?? "").trim() : "");
  const errors: string[] = [];
  const pickupAt = get("pickupDateTime") ? parseDateTime(get("pickupDateTime")) : parseDateTime(get("pickupDate"), get("pickupTime"));
  if (!pickupAt) errors.push("date ou heure illisible");
  else if (pickupAt.getTime() <= now.getTime()) errors.push("prise en charge déjà passée");
  const pickupAddress = get("pickupAddress"), dropoffAddress = get("dropoffAddress");
  if (!pickupAddress) errors.push("adresse de départ manquante");
  if (!dropoffAddress) errors.push("adresse d'arrivée manquante");
  let firstName = get("passengerFirstName"), lastName = get("passengerLastName");
  if (!firstName && !lastName && get("passengerName")) {
    const parts = get("passengerName").split(/\s+/);
    firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
    lastName = parts.length > 1 ? parts[parts.length - 1] : "-";
  }
  if (!firstName && !lastName) errors.push("nom du voyageur manquant");
  const phone = get("passengerPhone");
  if (phone.replace(/\D/g, "").length < 6) errors.push("téléphone du voyageur manquant ou invalide");
  const flightRaw = get("flightNumber");
  const flightNumber = flightRaw ? normalizeFlight(flightRaw) : null;
  if (flightRaw && !flightNumber) errors.push(`numéro de vol illisible (« ${flightRaw} »)`);
  const passengers = Math.round(num(get("passengers")) ?? 1);
  if (passengers < 1 || passengers > 8) errors.push("nombre de passagers hors limites (1 à 8)");
  const luggage = Math.max(0, Math.min(12, Math.round(num(get("luggage")) ?? 0)));
  const priceText = get("price");
  const priceCents = priceText ? parsePriceCents(priceText) : null;
  if (priceText && priceCents === null) errors.push(`prix illisible (« ${priceText} »)`);
  const email = get("passengerEmail");
  return {
    reference: get("reference") || null, pickupAt, pickupAddress, dropoffAddress,
    pickupCoords: coords(num(get("pickupLat")), num(get("pickupLng"))), dropoffCoords: coords(num(get("dropoffLat")), num(get("dropoffLng"))),
    firstName: firstName || "-", lastName: lastName || "-", phone, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    flightNumber, passengers: Math.max(1, Math.min(8, passengers)), luggage, priceCents,
    category: parseCategory(get("category")), notes: get("notes") || null, signText: get("signText") || null, errors,
  };
}
