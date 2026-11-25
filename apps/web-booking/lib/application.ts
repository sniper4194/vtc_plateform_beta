export interface Platform { name: string; rating: string }
export interface Form {
  firstName: string; lastName: string; phone: string; email: string; years: string; platforms: Platform[]; code: string; consent: boolean;
}
export const emptyForm: Form = { firstName: "", lastName: "", phone: "", email: "", years: "", platforms: [{ name: "", rating: "" }], code: "", consent: false };

/** Vérifie le formulaire côté navigateur (le serveur revérifie tout) ; renvoie un message par champ en erreur. */
export function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.firstName.trim()) e.firstName = "Indiquez votre prénom";
  if (!f.lastName.trim()) e.lastName = "Indiquez votre nom";
  if (f.phone.replace(/[^\d+]/g, "").length < 9) e.phone = "Numéro de téléphone invalide";
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "Adresse e-mail invalide";
  const y = Number(f.years);
  if (f.years.trim() === "" || !Number.isInteger(y) || y < 0 || y > 60) e.years = "Indiquez un nombre d'années entier";
  if (f.code.trim().length < 6) e.code = "Le code de parrainage est obligatoire";
  for (const p of f.platforms) {
    if (p.rating.trim() !== "" && (!p.name.trim() || !(Number(p.rating.replace(",", ".")) >= 0 && Number(p.rating.replace(",", ".")) <= 5))) { e.platforms = "Une note va de 0 à 5 et doit être accompagnée du nom de la plateforme"; break; }
  }
  if (!f.consent) e.consent = "Votre accord est nécessaire pour examiner la candidature";
  return e;
}

/** Corps envoyé au serveur : les lignes de plateforme vides sont ignorées. */
export function toPayload(f: Form) {
  return {
    firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: f.phone.trim(), email: f.email.trim(), yearsExperience: Number(f.years),
    otherPlatforms: f.platforms.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), ...(p.rating.trim() ? { rating: Number(p.rating.replace(",", ".")) } : {}) })),
    referralCode: f.code.trim(), consent: true as const,
  };
}
