export type Deadline = { type: string; label: string; status: "OK" | "SOON" | "EXPIRED" | "MISSING" | "PENDING"; daysLeft: number | null; expiresAt: string | null };

/** Texte court d'une échéance, en français. */
export function deadlineText(d: Pick<Deadline, "status" | "daysLeft" | "expiresAt">): string {
  const date = d.expiresAt ? new Date(d.expiresAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  if (d.status === "MISSING") return "Document manquant";
  if (d.status === "PENDING") return "En attente de validation par l'équipe";
  if (d.status === "EXPIRED") return `Expiré le ${date}`;
  if (d.daysLeft == null) return "Sans échéance";
  return d.daysLeft === 1 ? `Expire demain (${date})` : d.daysLeft <= 30 ? `Expire dans ${d.daysLeft} jours (${date})` : `Valable jusqu'au ${date}`;
}

export const deadlineSummary = (list: Deadline[] | null) => {
  if (!list) return "…";
  const bad = list.filter((d) => d.status === "EXPIRED" || d.status === "MISSING").length;
  const soon = list.filter((d) => d.status === "SOON").length;
  if (bad) return `${bad} document(s) expiré(s) ou manquant(s)`;
  if (soon) return `${soon} document(s) à renouveler sous 30 jours`;
  return "Tout est à jour";
};

