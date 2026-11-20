export const eur = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export function countdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400_000);
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `Aujourd'hui à ${hm}`;
  if (diff === 1) return `Demain à ${hm}`;
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} à ${hm}`;
}

/** Actions successives d'une course, selon son statut (reflète la machine à états de l'API). */
export const NEXT_ACTION: Record<string, { action: string; label: string } | undefined> = {
  ASSIGNED: { action: "en-route", label: "Je pars vers le client" },
  EN_ROUTE: { action: "arrived", label: "Je suis arrivé" },
  ARRIVED: { action: "start", label: "Client à bord — démarrer" },
  IN_PROGRESS: { action: "complete", label: "Terminer la course" },
};
