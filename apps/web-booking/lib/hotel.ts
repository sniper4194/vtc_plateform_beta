/** Espace hôtel : textes et calculs purs (testables). */

export const HOTEL_KEY = "clicab-hotel-key";

export const STATUS: Record<string, string> = {
  CONFIRMED: "Confirmée", DISPATCHING: "Recherche de chauffeur", ASSIGNED: "Chauffeur attribué", EN_ROUTE: "Chauffeur en route",
  ARRIVED: "Chauffeur sur place", IN_PROGRESS: "Client à bord", COMPLETED: "Terminée", CANCELLED_BY_PARTNER: "Annulée par l'hôtel",
  CANCELLED_BY_CLIENT: "Annulée", NO_SHOW: "Client absent", DISPUTED: "Litige en cours", REFUNDED: "Remboursée",
};
/** Statuts où la réception peut encore annuler (le serveur vérifie de nouveau). */
export const CANCELLABLE = new Set(["CONFIRMED", "DISPATCHING", "ASSIGNED", "EN_ROUTE"]);
export const DONE = new Set(["COMPLETED", "CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT", "NO_SHOW", "REFUNDED"]);

export type HotelRow = {
  id: string; reference: string; status: string; pickupAt: string; pickup: string; dropoff: string; room: string | null;
  passenger: string; flightNumber: string | null; payOnBoard: boolean; onBoardPayment?: { status: "PAID" | "ISSUE"; reason: string | null; resolved: boolean } | null; total: number; cancellationFee: number | null;
  driver: { firstName: string; vehicle: string | null; plate: string | null } | null; trackingUrl: string | null;
};

/** Paiement d'une course : qui paie, et pour une course payée à bord, si le chauffeur a encaissé. */
export function paymentLabel(r: Pick<HotelRow, "payOnBoard" | "onBoardPayment">) {
  if (!r.payOnBoard) return "Facturé à l'hôtel";
  if (r.onBoardPayment?.status === "PAID") return "Carte à bord : encaissé";
  if (r.onBoardPayment?.status === "ISSUE") return r.onBoardPayment.resolved ? "Carte à bord : impayé (traité par CliCab)" : "Carte à bord : impayé signalé";
  return "Carte à bord (client)";
}

/** Clé d'API reconnue (production ou test) ; le serveur reste seul juge. */
export function looksLikeKey(k: string) {
  return /^vtc_(live|test)_[A-Za-z0-9]{16,}$/.test(k.trim());
}

export function parisDateTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function parisMonth(d = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
}

/** Mois précédent / suivant au format AAAA-MM. */
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Point-virgule (Excel en français) ; guillemets doublés ; formule neutralisée (injection dans le tableur).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const money = (n: number | null) => (n == null ? "" : n.toFixed(2).replace(".", ","));

/** Relevé du mois pour Excel (séparateur « ; », virgule décimale, BOM pour les accents). Ce n'est pas une facture. */
export function statementCsv(rows: HotelRow[]) {
  const head = ["Date (Paris)", "Référence", "Chambre / réf.", "Client", "Départ", "Arrivée", "Statut", "Paiement", "Prix (€)", "Frais d'annulation (€)"];
  const lines = rows.map((r) => [
    parisDateTime(r.pickupAt), r.reference, r.room ?? "", r.passenger, r.pickup, r.dropoff, STATUS[r.status] ?? r.status,
    paymentLabel(r), money(r.total), money(r.cancellationFee),
  ]);
  return "﻿" + [head, ...lines].map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Textes de l'espace de commande selon la gamme du partenaire (null = hôtel par défaut). */
export const RANGE_TEXT: Record<string, { person: string; payer: string; billed: string; color: string; intro: string }> = {
  HOTEL: { person: "client", billed: "À facturer à l'hôtel", payer: "L'hôtel (sur le relevé du mois)", color: "#f7b30a", intro: "Commandez les transferts de vos clients et suivez-les en direct." },
  DEPANNAGE: { person: "client (assuré)", billed: "À facturer au garage ou à l'assurance", payer: "Le garage ou l'assurance (sur le relevé du mois)", color: "#ee2a14", intro: "Faites ramener votre client chez lui ou vers une solution de mobilité, tout de suite ou plus tard." },
  ASSOCIATION: { person: "bénéficiaire", billed: "À facturer à l'association", payer: "L'association (sur le relevé du mois)", color: "#0a8f5b", intro: "Organisez les trajets des personnes que vous accompagnez." },
  CARE: { person: "passager", billed: "À facturer à l'établissement", payer: "L'établissement (sur le relevé du mois)", color: "#1a66c2", intro: "Trajets des patients et visiteurs, hors transport sanitaire remboursé. Aucune information médicale n'est demandée." },
};
export const rangeText = (range: string | null | undefined) => RANGE_TEXT[range ?? "HOTEL"] ?? RANGE_TEXT.HOTEL;

/** Passagers d'une course CliCab Care : le passager et ses accompagnants (3 au plus). */
export const carePassengers = (escorts: string) => 1 + Math.min(3, Math.max(0, Number(escorts) || 0));
