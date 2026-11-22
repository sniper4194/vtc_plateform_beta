import { fmtDateTime } from "./notifications";

/**
 * Justificatif de réservation préalable : un chauffeur de VTC doit pouvoir prouver, en cas de contrôle, que la course a été réservée à l'avance
 * (Code des transports, art. L3120-2 ; arrêté du 6 août 2025 pour les modalités). Format papier ou électronique.
 * Contenu repris de la liste publiée par Service-Public (vérifiée le 12/08/2026) : à confirmer dans l'arrêté.
 */
export interface JustificatifInput {
  operatorName: string | null; operatorAddress?: string | null; revtcNumber: string | null; siret: string | null;
  clientName: string; clientPhone: string; reservedAt: Date; pickupAt: Date; pickupAddress: string; ref: number;
}

export function buildJustificatif(i: JustificatifInput) {
  const missing: string[] = [];
  if (!i.operatorName) missing.push("raison sociale de l'exploitant");
  if (!i.revtcNumber) missing.push("numéro d'inscription au registre des exploitants de VTC");
  if (!i.siret) missing.push("numéro Siren/Siret");
  return {
    reference: `R-${i.ref}`,
    complete: missing.length === 0,
    missing,
    lines: [
      ["Exploitant (VTC)", i.operatorName ?? "— à renseigner —"],
      ["N° d'inscription au registre des VTC (REVTC)", i.revtcNumber ?? "— à renseigner —"],
      ["N° Siren/Siret (RNE)", i.siret ?? "— à renseigner —"],
      ["Client", i.clientName],
      ["Téléphone du client", i.clientPhone],
      ["Réservation effectuée le", fmtDateTime(i.reservedAt)],
      ["Prise en charge souhaitée le", fmtDateTime(i.pickupAt)],
      ["Lieu de prise en charge", i.pickupAddress],
    ] as [string, string][],
  };
}
