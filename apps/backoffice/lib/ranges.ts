/** Gammes CliCab des partenaires : étiquette et couleur au tableau du dispatcheur (palette de l'affiche rétro). */
export const RANGES = {
  HOTEL: { label: "CliCab Hôtel", who: "hôtels, restaurants", color: "#f7b30a", text: "#14172b" },
  DEPANNAGE: { label: "CliCab Dépannage", who: "garages, assurances", color: "#ee2a14", text: "#ffffff" },
  ASSOCIATION: { label: "CliCab Association", who: "associations", color: "#0a8f5b", text: "#ffffff" },
  CARE: { label: "CliCab Care", who: "établissements de santé", color: "#1a66c2", text: "#ffffff" },
} as const;
export type RangeKey = keyof typeof RANGES;
export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];
export const rangeOf = (v: unknown) => (typeof v === "string" && v in RANGES ? RANGES[v as RangeKey] : null);

/** Détails saisis dans l'espace du partenaire, en clair pour le dispatcheur (aucune donnée médicale). */
export function rangeDetails(d: Record<string, any>): string[] {
  const out: string[] = [];
  if (d.leg === "ALLER") out.push("Aller d'un aller-retour");
  if (d.leg === "RETOUR") out.push("Retour d'un aller-retour");
  if (d.asap) out.push("⚡ Dès que possible");
  if (d.caseNumber) out.push(`Dossier ${d.caseNumber}`);
  if (d.brokenPlate) out.push(`Véhicule en panne ${d.brokenPlate}`);
  if (d.department) out.push(`Service : ${d.department}`);
  if (d.escorts) out.push(`${d.escorts} accompagnant(s)`);
  if (d.walkingAssist) out.push("Aide à la marche");
  return out;
}
