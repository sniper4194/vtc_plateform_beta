import { describe, expect, it } from "vitest";
import { isAtRisk, reliability } from "./guarantee";

const T0 = new Date("2026-12-01T12:00:00Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);

describe("garantie de prise en charge", () => {
  it("se déclenche dans la fenêtre avant la prise en charge, pas avant, ni longtemps après", () => {
    expect(isAtRisk(min(240), T0, 180)).toBe(false);
    expect(isAtRisk(min(180), T0, 180)).toBe(true);
    expect(isAtRisk(min(10), T0, 180)).toBe(true);
    expect(isAtRisk(min(-90), T0, 180)).toBe(false);
    expect(isAtRisk(min(10), T0, 0)).toBe(false); // désactivée
  });
});

describe("fiabilité", () => {
  const base = { effectivePickupAt: min(0), assignedAt: null, arrivedAt: null, exhausted: false, atRisk: false, gaveBack: 0 };
  it("calcule chaque taux sur son propre dénominateur", () => {
    const r = reliability([
      { ...base, status: "COMPLETED", assignedAt: min(-24 * 60), arrivedAt: min(-5) }, // tôt, à l'heure
      { ...base, status: "COMPLETED", assignedAt: min(-60), arrivedAt: min(4), atRisk: true }, // tard, en retard
      { ...base, status: "NO_SHOW", assignedAt: min(-300), arrivedAt: min(-1), gaveBack: 1 },
      { ...base, status: "DISPATCHING", exhausted: true, atRisk: true }, // jamais attribuée
      { ...base, status: "CANCELLED_BY_PARTNER" }, // non imputable
    ], 180);
    expect(r.missions).toBe(4);
    expect(r.cancelledByCustomer).toBe(1);
    expect(r.assignedEarly).toEqual({ num: 2, den: 3, pct: 66.7 });
    expect(r.arrivedOnTime).toEqual({ num: 2, den: 3, pct: 66.7 });
    expect(r.neverAssigned).toBe(1);
    expect(r.atRisk).toBe(2);
    expect(r).toMatchObject({ completed: 2, noShow: 1, givenBack: 1 });
  });
  it("n'affiche aucun taux quand il n'y a rien à compter", () => {
    const r = reliability([]);
    expect(r.assignedEarly.pct).toBeNull();
    expect(r.arrivedOnTime.pct).toBeNull();
    expect(r.missions).toBe(0);
  });
});
