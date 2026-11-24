/** Texte incrusté sur une photo-preuve (façon appareil photo horodaté) : date et heure, adresse, coordonnées. Fonctions pures. */

export const PROOF_KIND_LABEL: Record<string, string> = { NO_SHOW: "Client absent", EXCESS_LUGGAGE: "Bagages en excès", OTHER: "Autre preuve" };

/** « 24 nov. 2026 11:50:35 », à l'heure de Paris. */
export function formatStampDate(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Europe/Paris" })
    .format(d).replace(",", "");
}

export interface StampInput { at: Date; lat: number | null; lng: number | null; accuracyM?: number | null; address?: string | null; ref?: string; kind?: string }

/** Adresse découpée en lignes courtes (rue, ville, département…), comme sur l'image d'une application d'horodatage. */
export function addressLines(address?: string | null): string[] {
  return (address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function coordsLabel(lat: number | null, lng: number | null, accuracyM?: number | null): string {
  if (lat == null || lng == null) return "Position indisponible";
  const acc = accuracyM != null ? ` (±${Math.round(accuracyM)} m)` : "";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}${acc}`;
}

/** Lignes du cachet, de haut en bas : date et heure, adresse, coordonnées. */
export function stampLines(s: StampInput): string[] {
  return [formatStampDate(s.at), ...addressLines(s.address), coordsLabel(s.lat, s.lng, s.accuracyM)];
}

/** Ligne d'en-tête du cachet : de quelle mission et de quelle nature est la preuve. */
export function stampHeader(s: Pick<StampInput, "ref" | "kind">): string {
  return ["CliCab", s.ref, s.kind ? PROOF_KIND_LABEL[s.kind] ?? s.kind : null].filter(Boolean).join(" · ");
}
