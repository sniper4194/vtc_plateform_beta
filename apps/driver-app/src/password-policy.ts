/** Règles des nouveaux mots de passe uniquement. Les mots de passe existants restent valides. */
export const passwordRules = [
  { label: "15 à 128 caractères", test: (p: string) => p.length <= 128 && p.trim().length >= 15 },
  { label: "Une majuscule (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Une minuscule (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Un chiffre (0–9)", test: (p: string) => /[0-9]/.test(p) },
  { label: "Un caractère spécial (ex. !, @, #)", test: (p: string) => /[!-/:-@\x5b-\x60{-~]/.test(p) },
] as const;
export const validNewPassword = (p: string) => passwordRules.every(rule => rule.test(p));
