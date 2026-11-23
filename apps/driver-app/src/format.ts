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

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function dayTitle(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400_000);
  const label = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return diff === 0 ? `Ce jour · ${label}` : diff === 1 ? `Demain · ${label}` : label;
}

/** Regroupe des éléments (déjà triés) par jour local, pour une liste à sections. */
export function groupByDay<T>(items: T[], iso: (t: T) => string, now = new Date()) {
  const out: { key: string; title: string; data: T[] }[] = [];
  for (const it of items) {
    const key = dayKey(new Date(iso(it)));
    let sec = out.find((s) => s.key === key);
    if (!sec) out.push((sec = { key, title: dayTitle(iso(it), now), data: [] }));
    sec.data.push(it);
  }
  return out;
}

export const waitedMin = (arrivedAt: string | Date | null | undefined, now = new Date()) =>
  arrivedAt ? Math.max(0, Math.floor((now.getTime() - new Date(arrivedAt).getTime()) / 60_000)) : 0;

export const secondsUntil = (iso: string | Date | null | undefined, now = new Date()) =>
  iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 1000)) : 0;

export const MISSION_TITLE: Record<string, string> = {
  ASSIGNED: "Mission au programme",
  EN_ROUTE: "En route vers le client",
  ARRIVED: "Le client est attendu",
  IN_PROGRESS: "Course en cours",
  COMPLETED: "Mission terminée",
  CANCELLED_BY_PARTNER: "Mission annulée",
  CANCELLED_BY_CLIENT: "Mission annulée",
};

export const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Terminée", NO_SHOW: "Client absent", DISPUTED: "Litige", REFUNDED: "Remboursée",
  CANCELLED_BY_PARTNER: "Annulée", CANCELLED_BY_CLIENT: "Annulée",
};
export const isCancelled = (status: string) => status.startsWith("CANCELLED");

export const delayLabel = (min: number) => (min > 0 ? `+${min} min` : "à l'heure");

/** Libellé et ton du statut d'un vol, pour l'affichage chauffeur (même vocabulaire que les notifications). */
export function flightLabel(f: { status: string; delayMin: number; earlyMin?: number }): { text: string; tone: "ok" | "warn" | "bad" } {
  if (f.status === "CANCELLED") return { text: "annulé", tone: "bad" };
  if (f.status === "LANDED") return { text: "posé", tone: "ok" };
  if (f.delayMin > 0) return { text: `retardé +${f.delayMin} min`, tone: "warn" };
  if (f.status === "EARLY" && (f.earlyMin ?? 0) > 0) return { text: `en avance −${f.earlyMin} min`, tone: "ok" };
  return { text: "à l'heure", tone: "ok" };
}

export const hoursLabel = (h: number) => { const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
export const dayLabel = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });

/** Adresse de serveur saisie : http(s)://hôte[:port], sans chemin ni espace ; null si invalide. */
export function normalizeApiUrl(raw: string): string | null {
  const u = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+(:\d+)?$/i.test(u) ? u : null;
}
