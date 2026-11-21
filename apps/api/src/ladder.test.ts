import { describe, expect, it } from "vitest";
import { driverOfferCents, DEFAULT_LADDER, ladderFromEnv, nextIncrease } from "./ladder";

const CAP = 4176; // exemple : prix partenaire prévisionnel 41,76 €
const pickup = new Date("2026-11-22T05:15:00Z");
const minutesBefore = (m: number) => new Date(pickup.getTime() - m * 60_000);
const at = (m: number, cap = CAP, cfg = DEFAULT_LADDER) => driverOfferCents(cap, pickup, minutesBefore(m), cfg);

describe("échelle de prix chauffeur", () => {
  it("part à 85 % du plafond, loin de la mission", () => {
    expect(at(3 * 24 * 60)).toBe(3540); // 41,76 € × 0,85 = 35,496 € → arrondi vers le bas au pas de 0,10 € : 35,40 €
  });
  it("monte au fil du temps, sans jamais baisser ni dépasser le plafond", () => {
    let prev = 0;
    for (let m = 4 * 24 * 60; m >= -30; m -= 5) {
      const p = at(m);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(CAP);
      prev = p;
    }
    expect(at(60)).toBe(CAP);
    expect(at(0)).toBe(CAP);
    expect(at(-30)).toBe(CAP);
  });
  it("progresse linéairement entre 24 h et 1 h avant", () => {
    const mid = at((24 * 60 + 60) / 2);
    expect(mid).toBeGreaterThan(3540);
    expect(mid).toBeLessThan(CAP);
    expect(Math.abs(mid - CAP * 0.925)).toBeLessThanOrEqual(10); // milieu de la rampe : 92,5 % du plafond
  });
  it("une mission réservée en urgence est déjà proche du plafond", () => {
    expect(at(90)).toBeGreaterThan(CAP * 0.99);
    expect(at(90)).toBeLessThanOrEqual(CAP);
  });
  it("arrondit vers le bas au pas de prix", () => {
    for (let m = 24 * 60; m > 60; m -= 17) expect(at(m) % 10).toBe(0);
    expect(driverOfferCents(4176, pickup, minutesBefore(1000), { ...DEFAULT_LADDER, stepCents: 50 }) % 50).toBe(0);
  });
  it("désactivée : toujours le plafond", () => {
    expect(at(3 * 24 * 60, CAP, { ...DEFAULT_LADDER, enabled: false })).toBe(CAP);
  });
  it("cas limites : plafond nul, négatif, très petit", () => {
    expect(at(1000, 0)).toBe(0);
    expect(at(1000, -50)).toBe(0);
    expect(at(1000, 5)).toBeLessThanOrEqual(5);
  });
  it("configuration par variables d'environnement, bornée", () => {
    expect(ladderFromEnv({} as any)).toEqual(DEFAULT_LADDER);
    expect(ladderFromEnv({ PRICE_LADDER: "0" } as any).enabled).toBe(false);
    expect(ladderFromEnv({ LADDER_START_RATIO: "0.7", LADDER_FROM_MIN: "720", LADDER_TO_MIN: "30", LADDER_STEP_CENTS: "25" } as any)).toMatchObject({ startRatio: 0.7, rampFromMin: 720, rampToMin: 30, stepCents: 25 });
    expect(ladderFromEnv({ LADDER_START_RATIO: "0.01" } as any).startRatio).toBe(0.3); // jamais sous 30 %
    expect(ladderFromEnv({ LADDER_START_RATIO: "5" } as any).startRatio).toBe(1);
    expect(ladderFromEnv({ LADDER_FROM_MIN: "10", LADDER_TO_MIN: "60" } as any).rampFromMin).toBeGreaterThan(60); // rampe jamais inversée
    expect(ladderFromEnv({ LADDER_START_RATIO: "abc" } as any).startRatio).toBe(0.85);
  });
  it("annonce la prochaine hausse, ou rien au plafond", () => {
    const now = minutesBefore(600);
    const n = nextIncrease(CAP, pickup, now, DEFAULT_LADDER)!;
    expect(n.at.getTime()).toBeGreaterThan(now.getTime());
    expect(n.cents).toBeGreaterThan(driverOfferCents(CAP, pickup, now, DEFAULT_LADDER));
    expect(nextIncrease(CAP, pickup, minutesBefore(30), DEFAULT_LADDER)).toBeNull();
    expect(nextIncrease(CAP, pickup, now, { ...DEFAULT_LADDER, enabled: false })).toBeNull();
  });
});
