/**
 * Pénalités d'un chauffeur qui rend une mission ou fait appel à un sauveteur.
 * Principe : anticiper coûte moins cher que s'y prendre tard ; l'appel à un sauveteur coûte moins qu'une restitution sèche
 * (la mission est sauvée), mais jamais zéro. Barème et seuils : valeurs de départ, réglables par l'environnement.
 */
const num = (k: string, d: number) => (process.env[k] !== undefined && process.env[k] !== "" ? Number(process.env[k]) : d);

export const PENALTY = {
  get fileFeeCents() { return num("PENALTY_FILE_FEE_CENTS", 600); }, // frais de dossier ajoutés dans les 24 h
  get rescueRatio() { return num("PENALTY_RESCUE_RATIO", 0.5); }, // part de la pénalité due si un sauveteur reprend la mission
  get rescueMinCents() { return num("PENALTY_RESCUE_MIN_CENTS", 1000); },
  get windowDays() { return num("PENALTY_WINDOW_DAYS", 90); }, // fenêtre de comptage des récidives
};

/** Paliers : [minutes restantes minimales, montant fixe, part de la rémunération de la mission]. Du plus lointain au plus proche. */
export const TIERS: { fromMin: number; fixedCents: number; ratio: number; label: string }[] = [
  { fromMin: 48 * 60, fixedCents: 1000, ratio: 0, label: "plus de 48 h avant" },
  { fromMin: 24 * 60, fixedCents: 2000, ratio: 0, label: "24 à 48 h avant" },
  { fromMin: 6 * 60, fixedCents: 0, ratio: 1, label: "6 à 24 h avant" },
  { fromMin: -Infinity, fixedCents: 0, ratio: 1.5, label: "moins de 6 h avant" },
];

/** Montant dû si le chauffeur rend la mission `minutesBefore` minutes avant la prise en charge effective. */
export function giveBackPenaltyCents(netCents: number, minutesBefore: number): number {
  const t = TIERS.find((x) => minutesBefore >= x.fromMin)!;
  const base = t.fixedCents + Math.round(netCents * t.ratio);
  return base + (minutesBefore < 24 * 60 ? PENALTY.fileFeeCents : 0);
}

/** Un sauveteur a repris la mission : pénalité réduite (plancher pour que l'appel ne soit jamais gratuit). */
export function rescuePenaltyCents(netCents: number, minutesBefore: number): number {
  return Math.max(PENALTY.rescueMinCents, Math.round(giveBackPenaltyCents(netCents, minutesBefore) * PENALTY.rescueRatio));
}

export type Sanction = "NONE" | "SUSPEND_48H" | "SUSPEND_7D" | "REVIEW";

/** Sanction selon le score de récidive (restitutions = 1, appels à un sauveteur = 0,5) sur la fenêtre glissante. */
export function sanctionFor(score: number): Sanction {
  if (score >= 5) return "REVIEW"; // fermeture définitive : décision humaine de l'équipe
  if (score >= 4) return "SUSPEND_7D";
  if (score >= 3) return "SUSPEND_48H";
  return "NONE";
}

export const SANCTION_TEXT: Record<Sanction, string> = {
  NONE: "",
  SUSPEND_48H: "Votre compte est suspendu 48 heures (récidive).",
  SUSPEND_7D: "Votre compte est suspendu 7 jours (récidive).",
  REVIEW: "Votre compte est suspendu dans l'attente d'un examen par l'équipe, qui peut aller jusqu'à la fermeture définitive (récidive).",
};
export const SANCTION_HOURS: Record<Sanction, number | null> = { NONE: 0, SUSPEND_48H: 48, SUSPEND_7D: 168, REVIEW: null };
