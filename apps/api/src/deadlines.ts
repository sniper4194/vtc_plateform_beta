/**
 * Échéances des documents obligatoires : rappels avant expiration. La fiche Service-Public précise qu'aucun rappel
 * n'est envoyé au chauffeur pour le contrôle technique ; un contrôle expiré immobilise le véhicule.
 */
export const DOC_LABEL: Record<string, string> = {
  VTC_CARD: "Carte professionnelle VTC", DRIVING_LICENSE: "Permis de conduire", INSURANCE: "Assurance",
  ID: "Pièce d'identité", REGISTRATION_CERT: "Carte grise", TECHNICAL_INSPECTION: "Contrôle technique", KBIS: "Extrait Kbis",
};
export const THRESHOLDS = [30, 14, 7, 1, 0] as const; // jours avant l'échéance ; 0 = le jour de l'expiration et après
const DAY = 86400_000;

/** Jours restants (arrondis au supérieur) : 0 le jour de l'échéance, négatif si dépassée. */
export const daysLeft = (expiresAt: Date, now = new Date()) => Math.ceil((expiresAt.getTime() - now.getTime()) / DAY) + 0; // « + 0 » évite -0

/** Palier de rappel atteint, ou null si l'échéance est encore lointaine. Un document expiré donne toujours 0. */
export function thresholdFor(days: number): number | null {
  if (days <= 0) return 0;
  const hit = [...THRESHOLDS].reverse().find((t) => t >= days && t > 0); // plus petit palier ≥ jours restants
  return hit ?? null;
}

export type DeadlineStatus = "OK" | "SOON" | "EXPIRED" | "MISSING" | "PENDING";

export function deadlineStatus(doc: { status: string; expiresAt: Date | null } | null, now = new Date()): { status: DeadlineStatus; days: number | null } {
  if (!doc) return { status: "MISSING", days: null };
  if (doc.status !== "APPROVED") return { status: "PENDING", days: doc.expiresAt ? daysLeft(doc.expiresAt, now) : null };
  if (!doc.expiresAt) return { status: "OK", days: null };
  const d = daysLeft(doc.expiresAt, now);
  return { status: d <= 0 ? "EXPIRED" : d <= 30 ? "SOON" : "OK", days: d };
}

export function expiryMessage(type: string, days: number, expiresAt: Date) {
  const label = DOC_LABEL[type] ?? type;
  const date = expiresAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
  if (days <= 0) {
    return {
      type: "DOC_EXPIRED", title: `${label} expiré`,
      body: `Votre ${label.toLowerCase()} a expiré le ${date}. Vous êtes hors ligne : renouvelez-le puis transmettez le nouveau document pour reprendre${type === "TECHNICAL_INSPECTION" ? " (un contrôle technique expiré immobilise le véhicule)" : ""}.`,
    };
  }
  const when = days === 1 ? "demain" : `dans ${days} jours`;
  const extra = type === "TECHNICAL_INSPECTION" ? " Le contrôle technique est annuel pour un VTC et aucun rappel officiel n'est envoyé." : type === "VTC_CARD" ? " Le renouvellement demande un stage de formation continue de 14 heures, à prévoir à l'avance." : "";
  return { type: "DOC_EXPIRING", title: `${label} : échéance ${when}`, body: `Votre ${label.toLowerCase()} expire le ${date} (${when}).${extra} Pensez à le renouveler et à transmettre le nouveau document avant l'échéance pour ne pas être mis hors ligne.` };
}
