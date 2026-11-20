export const eur = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/** Entier si rond (44 €), sinon 2 décimales (44,50 €). */
export const eurShort = (cents: number) =>
  cents % 100 === 0 ? `${cents / 100} €` : eur(cents);

export function countdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400_000);
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `Ce jour · ${hm}`;
  if (diff === 1) return `Demain · ${hm}`;
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · ${hm}`;
}

/** Les 4 étapes d'une mission, dans l'ordre de la machine à états de l'API. */
export const STEPS = [
  { status: "ASSIGNED", action: "en-route", short: "Départ", hold: "Je démarre vers le client" },
  { status: "EN_ROUTE", action: "arrived", short: "Sur place", hold: "Je suis devant le client" },
  { status: "ARRIVED", action: "start", short: "À bord", hold: "Client à bord, on roule" },
  { status: "IN_PROGRESS", action: "complete", short: "Arrivée", hold: "Mission terminée" },
] as const;

export const stepIndex = (status: string) => STEPS.findIndex((s) => s.status === status);
export const NEXT_ACTION = (status: string) => STEPS.find((s) => s.status === status);

/** Fraction restante du sursis d'une offre (la barre « mèche »). */
export function fuseFraction(left: number, total: number) {
  return total <= 0 ? 0 : Math.min(1, Math.max(0, left / total));
}
