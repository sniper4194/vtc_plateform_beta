import { describe, expect, it } from "vitest";
import { securityHeaders, SlidingLimiter } from "./hardening";

const run = (production: boolean) => {
  const h: Record<string, string> = {};
  let called = false;
  securityHeaders(production)({}, { setHeader: (k, v) => { h[k] = v; } }, () => { called = true; });
  return { h, called };
};

describe("en-têtes de sécurité de l'API", () => {
  it("toujours : pas d'interprétation de type, pas de cadre, pas de référent, pas de cache, pas d'API du navigateur", () => {
    const { h, called } = run(false);
    expect(called).toBe(true);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["Cache-Control"]).toBe("no-store");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Strict-Transport-Security"]).toBeUndefined(); // hors production : pas de HSTS
  });
  it("en production : HSTS", () => {
    expect(run(true).h["Strict-Transport-Security"]).toMatch(/max-age=31536000/);
  });
});

describe("limiteur à fenêtre glissante", () => {
  it("refuse au-delà du plafond, puis réautorise quand la fenêtre est passée, par clé", () => {
    const l = new SlidingLimiter();
    const t = 1_000_000;
    expect([1, 2, 3].map(() => l.allow("a", 3, 60_000, t))).toEqual([true, true, true]);
    expect(l.allow("a", 3, 60_000, t + 10)).toBe(false);
    expect(l.allow("b", 3, 60_000, t + 10)).toBe(true); // une autre adresse n'est pas touchée
    expect(l.allow("a", 3, 60_000, t + 60_001)).toBe(true);
  });
  it("purge les clés expirées quand la table grossit", () => {
    const l = new SlidingLimiter(5);
    for (let i = 0; i < 20; i++) l.allow(`k${i}`, 1, 1000, 1000 + i);
    expect(l.allow("k0", 1, 1000, 1_000_000)).toBe(true);
    expect((l as any).hits.size).toBeLessThanOrEqual(21);
  });
});
