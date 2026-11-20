import { describe, expect, it, vi } from "vitest";
import { estimateRoute, OsrmProvider, RoutingService } from "./routing";

const A = { lat: 49.0097, lng: 2.5479 }, B = { lat: 48.8566, lng: 2.3522 };
const ok = (distance: number, duration: number) => ({ ok: true, status: 200, json: async () => ({ code: "Ok", routes: [{ distance, duration }] }) }) as any;

describe("OsrmProvider", () => {
  it("interroge OSRM (longitude,latitude) et convertit m → km, s → min", async () => {
    const f = vi.fn().mockResolvedValue(ok(31200, 2100));
    const r = await new OsrmProvider("http://osrm.test/", f as any).route(A, B, new AbortController().signal);
    expect(r).toEqual({ distanceKm: 31.2, durationMin: 35 });
    expect(f.mock.calls[0][0]).toBe("http://osrm.test/route/v1/driving/2.5479,49.0097;2.3522,48.8566?overview=false&alternatives=false");
  });
  it("rejette une réponse en erreur ou inattendue", async () => {
    const bad = (j: any, status = 200) => new OsrmProvider("http://x", vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => j }) as any).route(A, B, new AbortController().signal);
    await expect(bad({}, 500)).rejects.toThrow(/HTTP 500/);
    await expect(bad({ code: "NoRoute", routes: [] })).rejects.toThrow(/inattendue/);
    await expect(bad({ code: "Ok", routes: [{ distance: "x" }] })).rejects.toThrow(/inattendue/);
  });
});

describe("RoutingService", () => {
  const svc = (route: any) => { const s = new RoutingService(); s.provider = { route } as any; return s; };

  it("sans fournisseur : estimation", async () => {
    const s = new RoutingService(); s.provider = null;
    const r = await s.estimate(A, B);
    expect(r.source).toBe("estimate");
    expect(r.distanceKm).toBeCloseTo(estimateRoute(A, B).distanceKm);
  });
  it("utilise le fournisseur et met en cache (une seule requête pour deux adresses voisines)", async () => {
    const route = vi.fn().mockResolvedValue({ distanceKm: 31.2, durationMin: 35 });
    const s = svc(route);
    expect(await s.estimate(A, B)).toMatchObject({ distanceKm: 31.2, source: "road" });
    await s.estimate({ lat: A.lat + 0.00001, lng: A.lng }, B);
    expect(route).toHaveBeenCalledTimes(1);
  });
  it("le cache expire au bout de 24 h", async () => {
    const route = vi.fn().mockResolvedValue({ distanceKm: 1, durationMin: 2 });
    const s = svc(route); const t0 = Date.now();
    await s.estimate(A, B, t0); await s.estimate(A, B, t0 + 25 * 3600_000);
    expect(route).toHaveBeenCalledTimes(2);
  });
  it("repli sur l'estimation si le fournisseur échoue", async () => {
    const r = await svc(vi.fn().mockRejectedValue(new Error("panne"))).estimate(A, B);
    expect(r.source).toBe("estimate");
    expect(r.distanceKm).toBeGreaterThan(20);
  });
  it("coupe-circuit : après 3 échecs, le fournisseur n'est plus appelé pendant 60 s, puis reprend", async () => {
    const route = vi.fn().mockRejectedValue(new Error("panne"));
    const s = svc(route); const t0 = Date.now();
    for (let i = 0; i < 3; i++) await s.estimate({ lat: 48 + i, lng: 2 }, B, t0);
    expect(route).toHaveBeenCalledTimes(3);
    await s.estimate({ lat: 40, lng: 2 }, B, t0 + 1000);
    expect(route).toHaveBeenCalledTimes(3); // en pause
    route.mockResolvedValue({ distanceKm: 5, durationMin: 9 });
    expect((await s.estimate({ lat: 41, lng: 2 }, B, t0 + 61_000)).source).toBe("road");
  });
  it("abandonne un fournisseur trop lent", async () => {
    const s = svc((_a: any, _b: any, signal: AbortSignal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("abort")))));
    s.timeoutMs = 30;
    expect((await s.estimate(A, B)).source).toBe("estimate");
  });
});
