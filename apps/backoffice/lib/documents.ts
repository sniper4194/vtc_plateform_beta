/** Noms lisibles des documents chauffeur (mêmes libellés que l'API, apps/api/src/deadlines.ts). */
export const DOC_LABEL: Record<string, string> = {
  VTC_CARD: "Carte professionnelle VTC", DRIVING_LICENSE: "Permis de conduire", INSURANCE: "Assurance",
  ID: "Pièce d'identité", REGISTRATION_CERT: "Carte grise", TECHNICAL_INSPECTION: "Contrôle technique", KBIS: "Extrait Kbis",
  AIRPORT_BADGE: "Badge d'accès aéroport (facture parking ADP)",
};
export const docLabel = (type: string) => DOC_LABEL[type] ?? type;
