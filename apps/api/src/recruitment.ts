import { randomBytes } from "node:crypto";

/**
 * Règles du parcours de candidature. Seuils réglables par variables d'environnement : ce sont des choix de l'équipe, pas des normes légales.
 * Rien ici ne décide à la place d'une personne : `readiness` liste ce qui manque, et la décision reste humaine.
 */
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];
export const levelRank = (l: string | null | undefined) => (l ? LEVELS.indexOf(l as Level) : -1);

export function thresholds(env: NodeJS.ProcessEnv = process.env) {
  const n = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  const level = env.APPLY_MIN_ENGLISH && levelRank(env.APPLY_MIN_ENGLISH) >= 0 ? env.APPLY_MIN_ENGLISH : "B1";
  return {
    minPoints: n(env.APPLY_MIN_POINTS, 8), // points restants sur le permis
    minFrench: n(env.APPLY_MIN_FRENCH, 60), // /100
    minEthics: n(env.APPLY_MIN_ETHICS, 70), // /100
    minEnglish: level as Level,
    minYears: n(env.APPLY_MIN_YEARS, 0), // années d'expérience (0 : renseignée mais non éliminatoire)
    codesPerDriver: n(env.REFERRAL_CODES_PER_DRIVER, 3),
    retestDays: n(env.APPLY_RETEST_DAYS, 30), // délai avant de pouvoir redéposer après un refus
    retentionDays: n(env.APPLY_RETENTION_DAYS, 180), // conservation des candidatures refusées ou retirées
    cardMarginDays: n(env.APPLY_CARD_MARGIN_DAYS, 30), // la carte pro doit rester valable au moins ce nombre de jours
  };
}

export interface ApplicationFacts {
  yearsExperience: number;
  cardProValidUntil: Date | null;
  licenceCheckedAt: Date | null;
  licencePointsOk: boolean | null;
  licenceNoSuspension: boolean | null;
  honorStatementAt: Date | null;
  frenchScore: number | null;
  englishLevel: string | null;
  ethicsScore: number | null;
  interviewAt: Date | null;
}

/** Liste ce qui empêche encore d'accepter la candidature (vide : prête pour la décision). */
export function readiness(a: ApplicationFacts, now = new Date(), t = thresholds()) {
  const missing: string[] = [];
  if (a.yearsExperience < t.minYears) missing.push(`Expérience insuffisante (minimum ${t.minYears} an${t.minYears > 1 ? "s" : ""})`);
  const horizon = new Date(now.getTime() + t.cardMarginDays * 86_400_000);
  if (!a.cardProValidUntil) missing.push("Carte professionnelle VTC non vérifiée");
  else if (a.cardProValidUntil < horizon) missing.push(`Carte professionnelle expirée ou valable moins de ${t.cardMarginDays} jours`);
  if (!a.licenceCheckedAt) missing.push("Relevé d'information intégral (RII) non vérifié");
  else {
    if (a.licencePointsOk !== true) missing.push(`Permis : moins de ${t.minPoints} points`);
    if (a.licenceNoSuspension !== true) missing.push("Permis : suspension ou invalidation en cours");
  }
  if (!a.honorStatementAt) missing.push("Déclaration sur l'honneur (absence de condamnation incompatible) non reçue");
  if (a.frenchScore == null) missing.push("Test de français non passé");
  else if (a.frenchScore < t.minFrench) missing.push(`Test de français : ${a.frenchScore}/100 (minimum ${t.minFrench})`);
  if (!a.englishLevel) missing.push("Niveau d'anglais non évalué");
  else if (levelRank(a.englishLevel) < levelRank(t.minEnglish)) missing.push(`Anglais : ${a.englishLevel} (minimum ${t.minEnglish})`);
  if (a.ethicsScore == null) missing.push("Mise en situation « éthique » non passée");
  else if (a.ethicsScore < t.minEthics) missing.push(`Éthique : ${a.ethicsScore}/100 (minimum ${t.minEthics})`);
  if (!a.interviewAt) missing.push("Entretien non réalisé");
  return missing;
}

/** Code lisible, sans caractères ambigus (0/O, 1/I) : CLI-XXXX-XXXX. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReferralCode(): string {
  const b = randomBytes(8);
  const ch = (i: number) => ALPHABET[b[i] % ALPHABET.length];
  return `CLI-${ch(0)}${ch(1)}${ch(2)}${ch(3)}-${ch(4)}${ch(5)}${ch(6)}${ch(7)}`;
}
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");
