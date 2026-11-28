/** Motifs d'impayé : mêmes codes que l'API (ON_BOARD_ISSUES). */
export const ON_BOARD_ISSUE_LABEL: Record<string, string> = {
  DECLINED: "Carte refusée",
  REFUSED: "Le client refuse de payer",
  TERMINAL: "Terminal en panne ou sans réseau",
  OTHER: "Autre problème",
};

export type OnBoardPayment = { status: "PAID" } | { status: "ISSUE"; reason: string; note?: string };

/** Corps envoyé à « terminer la course » ; la note n'est envoyée que si elle est remplie. */
export function paymentBody(p: OnBoardPayment) {
  if (p.status === "PAID") return { payment: { status: "PAID" } };
  const note = p.note?.trim();
  return { payment: { status: "ISSUE", reason: p.reason, ...(note ? { note } : {}) } };
}

