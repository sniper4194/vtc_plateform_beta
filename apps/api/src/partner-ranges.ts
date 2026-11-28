import { z } from "zod";

/**
 * Gammes CliCab : chaque partenaire voit un espace de commande adapté à son métier, et le chauffeur
 * reçoit des consignes propres à la gamme. Aucune donnée médicale n'est demandée ni conservée (CliCab Care).
 */
export const RANGE_INFO = {
  HOTEL: { label: "CliCab Hôtel", space: "Espace hôtel", addressMode: "hub" },
  DEPANNAGE: { label: "CliCab Dépannage", space: "Espace dépannage", addressMode: "free" },
  ASSOCIATION: { label: "CliCab Association", space: "Espace association", addressMode: "free" },
  CARE: { label: "CliCab Care", space: "Espace CliCab Care", addressMode: "free" },
} as const;
export type RangeKey = keyof typeof RANGE_INFO;

/** Champs propres à chaque gamme (tous facultatifs) ; ce qui n'appartient pas à la gamme est refusé. */
export const DETAILS_SCHEMA = {
  HOTEL: z.object({}).strict(),
  DEPANNAGE: z.object({
    caseNumber: z.string().trim().max(40).optional(),
    brokenPlate: z.string().trim().toUpperCase().max(12).optional(),
  }).strict(),
  ASSOCIATION: z.object({}).strict(),
  CARE: z.object({
    department: z.string().trim().max(80).optional(),
    escorts: z.number().int().min(0).max(3).optional(),
    walkingAssist: z.boolean().optional(),
  }).strict(),
} as const;
export type Details = { caseNumber?: string; brokenPlate?: string; department?: string; escorts?: number; walkingAssist?: boolean; leg?: "ALLER" | "RETOUR"; asap?: boolean };

export function rangeOf(range: string | null | undefined): RangeKey | null {
  return range && range in RANGE_INFO ? (range as RangeKey) : null;
}

/** Fonctions offertes à l'écran de commande, selon la gamme. */
export function rangeFeatures(range: RangeKey | null) {
  return {
    room: range === null || range === "HOTEL",
    caseNumber: range === "DEPANNAGE", brokenPlate: range === "DEPANNAGE", asap: range === "DEPANNAGE",
    returnTrip: range === "CARE" || range === "ASSOCIATION",
    department: range === "CARE", escorts: range === "CARE", walkingAssist: range === "CARE",
  };
}

/** Délai d'une commande « dès que possible » (minutes) : le temps qu'un chauffeur proche arrive. À confirmer. */
export const asapLeadMin = () => Math.max(5, Number(process.env.ASAP_LEAD_MIN) || 20);

/** Consignes affichées au chauffeur sur l'offre et la mission. */
export function driverInstructions(range: RangeKey | null, d: Details | null | undefined): string[] {
  const out: string[] = [];
  if (!d) return out;
  if (d.leg === "RETOUR") out.push("Trajet retour d'un aller-retour");
  if (d.asap) out.push("Urgence : le client attend, partez dès que possible");
  if (range === "DEPANNAGE") {
    if (d.caseNumber) out.push(`Dossier n° ${d.caseNumber}`);
    if (d.brokenPlate) out.push(`Véhicule en panne : ${d.brokenPlate}`);
  }
  if (range === "CARE") {
    if (d.department) out.push(`Déposer au service / à l'étage : ${d.department}`);
    if (d.escorts) out.push(`${d.escorts} accompagnant${d.escorts > 1 ? "s" : ""} à bord`);
    if (d.walkingAssist) out.push("Aider le passager à marcher jusqu'à la porte");
    out.push("Prendre son temps : conduite douce, attendre que le passager soit installé");
  }
  return out;
}
