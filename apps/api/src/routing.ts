import { Injectable, Logger } from "@nestjs/common";
import { haversineKm } from "./zones";

export interface LatLng { lat: number; lng: number }
export interface RouteResult { distanceKm: number; durationMin: number }
export type RouteSource = "road" | "estimate";

export interface RoutingProvider {
  route(a: LatLng, b: LatLng, signal: AbortSignal): Promise<RouteResult>;
}

/** Estimation sans réseau : distance à vol d'oiseau ×1,3, vitesse moyenne 35 km/h. Sert de repli. */
export function estimateRoute(a: LatLng, b: LatLng): RouteResult {
  const distanceKm = haversineKm(a, b) * 1.3;
  return { distanceKm, durationMin: Math.max(5, (distanceKm / 35) * 60) };
}

/**
 * Adaptateur OSRM (API HTTP `route/v1/driving`). Les durées OSRM ne tiennent pas compte du trafic.
 * Ne pas utiliser le serveur de démonstration public en production (conditions d'usage) : héberger OSRM ou changer de fournisseur.
 */
export class OsrmProvider implements RoutingProvider {
  constructor(private baseUrl: string, private fetchImpl: typeof fetch = fetch) {}
  async route(a: LatLng, b: LatLng, signal: AbortSignal): Promise<RouteResult> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&alternatives=false`;
    const res = await this.fetchImpl(url, { signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body: any = await res.json();
    const r = body?.routes?.[0];
    if (body?.code !== "Ok" || typeof r?.distance !== "number" || typeof r?.duration !== "number") throw new Error(`OSRM réponse inattendue (${body?.code ?? "?"})`);
    return { distanceKm: r.distance / 1000, durationMin: Math.max(1, r.duration / 60) };
  }
}

const TTL_MS = 24 * 3600_000;
const MAX_ENTRIES = 5000;
const TIMEOUT_MS = 3000;
const BREAKER_FAILURES = 3;
const BREAKER_PAUSE_MS = 60_000;

/**
 * Distance/durée d'un trajet : fournisseur routier si configuré (ROUTING_URL), sinon ou en cas d'échec, estimation.
 * Un cache évite de recalculer deux fois le même trajet ; un coupe-circuit évite d'attendre un fournisseur en panne.
 */
@Injectable()
export class RoutingService {
  private log = new Logger("routing");
  provider: RoutingProvider | null = process.env.ROUTING_URL ? new OsrmProvider(process.env.ROUTING_URL) : null;
  private cache = new Map<string, { at: number; value: RouteResult }>();
  private failures = 0;
  private pausedUntil = 0;
  timeoutMs = TIMEOUT_MS;

  private key(a: LatLng, b: LatLng) {
    const r = (n: number) => n.toFixed(4); // ≈ 11 m : deux adresses voisines partagent le résultat
    return `${r(a.lat)},${r(a.lng)}>${r(b.lat)},${r(b.lng)}`;
  }

  async estimate(a: LatLng, b: LatLng, now = Date.now()): Promise<RouteResult & { source: RouteSource }> {
    if (!this.provider) return { ...estimateRoute(a, b), source: "estimate" };
    const k = this.key(a, b);
    const hit = this.cache.get(k);
    if (hit && now - hit.at < TTL_MS) return { ...hit.value, source: "road" };
    if (now < this.pausedUntil) return { ...estimateRoute(a, b), source: "estimate" };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const value = await this.provider.route(a, b, ctl.signal);
      this.failures = 0;
      if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(k, { at: now, value });
      return { ...value, source: "road" };
    } catch (e: any) {
      if (++this.failures >= BREAKER_FAILURES) {
        this.pausedUntil = now + BREAKER_PAUSE_MS;
        this.failures = 0;
        this.log.warn(`fournisseur de routage en pause 60 s (${e?.message ?? e})`);
      }
      return { ...estimateRoute(a, b), source: "estimate" };
    } finally {
      clearTimeout(timer);
    }
  }
}
