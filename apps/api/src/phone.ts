/** Normalise un numéro de téléphone au format E.164. Retourne null s'il est invalide. */
export function normalizePhone(raw: string, defaultCountry = "+33"): string | null {
  let p = raw.trim().replace(/[\s.\-()]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^0\d{9}$/.test(p)) p = defaultCountry + p.slice(1); // 06 12 34 56 78 → +33612345678
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}
