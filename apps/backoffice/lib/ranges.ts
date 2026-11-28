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
