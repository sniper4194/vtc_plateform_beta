/**
 * En-têtes de sécurité de l'API (réponses JSON ou images, jamais de page HTML) :
 * pas d'interprétation de type, pas d'affichage dans un cadre, pas de référent, aucune API du navigateur, pas de cache par défaut.
 * HSTS seulement en production (derrière HTTPS). Les routes qui servent une image posent leur propre Cache-Control.
 */
export function securityHeaders(production = process.env.NODE_ENV === "production") {
  return (_req: unknown, res: { setHeader(name: string, value: string): unknown }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader("Cache-Control", "no-store");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  };
}

/** Limiteur à fenêtre glissante, en mémoire (par instance). La table est purgée pour ne pas grossir sans fin. */
export class SlidingLimiter {
  private hits = new Map<string, number[]>();
  constructor(private maxKeys = 10_000) {}
  /** Renvoie false quand la clé a déjà atteint `max` appels dans la fenêtre `windowMs`. */
  allow(key: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k);
    return true;
  }
}
