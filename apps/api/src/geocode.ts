import { Injectable, Logger } from "@nestjs/common";
import { HUBS } from "./hosted";

export interface Point { lat: number; lng: number }

/**
 * Aéroports et gares reconnus sans service extérieur (rien n'est envoyé hors de CliCab).
 * Coordonnées approximatives, les mêmes que la réservation clé en main (à vérifier, voir CLAUDE.md).
 */
export function knownPlace(address: string): Point | null {
  const s = address.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hub = (id: string) => { const h = HUBS.find((x) => x.id === id)!; return { lat: h.lat, lng: h.lng }; };
  if (/\bcdg\b|charles[\s-]*de[\s-]*gaulle|roissy/.test(s)) return hub(/terminal\s*1\b|\bt1\b/.test(s) ? "CDG-T1" : "CDG-T2");
  if (/\borly\b|\bory\b/.test(s)) return hub("ORY");
  if (/beauvais|\bbva\b|tille/.test(s)) return hub("BVA");
  if (/gare\s+du\s+nord|paris[\s-]*nord/.test(s)) return hub("GARE-NORD");
  if (/gare\s+de\s+lyon|paris[\s-]*lyon/.test(s)) return hub("GARE-LYON");
  if (/montparnasse/.test(s)) return hub("GARE-MONTPARNASSE");
  if (/gare\s+de\s+l.?est|paris[\s-]*est/.test(s)) return hub("GARE-EST");
  if (/saint[\s-]*lazare/.test(s)) return hub("GARE-SAINT-LAZARE");
  return null;
}

/**
 * Position GPS d'une adresse : lieu connu, sinon Base Adresse Nationale (service public gratuit, sans clé).
 * Seule l'adresse est envoyée, jamais le nom ou le téléphone du voyageur. GEOCODER=0 désactive l'appel extérieur.
 */
@Injectable()
export class GeocodeService {
  private log = new Logger("geocode");
  fetcher: typeof fetch = (...a) => fetch(...a);

  async locate(address: string): Promise<Point | null> {
    const f = await this.find(address);
    return f ? { lat: f.lat, lng: f.lng } : null;
  }

  /** Comme locate, avec l'adresse retrouvée (libellé de la BAN) pour que la personne vérifie que c'est la bonne. */
  async find(address: string): Promise<(Point & { label: string }) | null> {
    const known = knownPlace(address);
    if (known) return { ...known, label: address.trim() };
    if (process.env.GEOCODER === "0") return null;
    const base = process.env.GEOCODER_URL ?? "https://api-adresse.data.gouv.fr/search/";
    try {
      const res = await this.fetcher(`${base}?q=${encodeURIComponent(address.slice(0, 200))}&limit=1`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body: any = await res.json();
      const f = body?.features?.[0];
      // Score de confiance de la BAN : en dessous de 0,5, l'adresse trouvée risque de ne pas être la bonne.
      if (!f || (f.properties?.score ?? 0) < 0.5) return null;
      const [lng, lat] = f.geometry.coordinates;
      return { lat, lng, label: String(f.properties?.label ?? address).slice(0, 200) };
    } catch (e: any) {
      this.log.warn(`Géocodage impossible : ${e?.name ?? "erreur"}`);
      return null;
    }
  }
}
