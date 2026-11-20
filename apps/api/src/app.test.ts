import { describe, expect, it } from "vitest";
import { AppController } from "./app";

describe("AppController", () => {
  const c = new AppController();
  it("health", () => expect(c.health()).toEqual({ status: "ok" }));
  it("devis", () => {
    const r = c.quote({
      pickup: { address: "a", lat: 48.85, lng: 2.35 },
      dropoff: { address: "b", lat: 48.9, lng: 2.4 },
      pickupAt: "2026-12-02T10:00:00Z", category: "BERLINE", passengers: 1,
    });
    expect(r.total).toBeGreaterThanOrEqual(15);
    expect(r.driverNet).toBeLessThan(r.total);
  });
  it("devis invalide", () => expect(() => c.quote({})).toThrow());
});
