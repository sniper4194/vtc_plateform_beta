import { describe, expect, it } from "vitest";
import { giveBackPenaltyCents, rescuePenaltyCents, sanctionFor } from "./penalties";

const H = 60;
describe("barème de pénalités", () => {
  it("croît à mesure que la prise en charge approche", () => {
    const net = 4400;
    const at = (h: number) => giveBackPenaltyCents(net, h * H);
    expect(at(72)).toBe(1000); // > 48 h : forfait
    expect(at(30)).toBe(2000); // 24–48 h : forfait supérieur
    expect(at(12)).toBe(4400 + 600); // 6–24 h : 100 % + frais de dossier
    expect(at(2)).toBe(Math.round(4400 * 1.5) + 600); // < 6 h : 150 % + frais
    expect(at(-10)).toBe(at(2)); // trop tard : palier maximal
    expect(at(72)).toBeLessThan(at(30));
    expect(at(30)).toBeLessThan(at(12));
    expect(at(12)).toBeLessThan(at(2));
  });
  it("l'appel à un sauveteur coûte moins qu'une restitution, jamais zéro", () => {
    for (const h of [72, 30, 12, 2]) {
      const full = giveBackPenaltyCents(4400, h * H), res = rescuePenaltyCents(4400, h * H);
      expect(res).toBeLessThanOrEqual(full);
      expect(res).toBeGreaterThanOrEqual(1000);
    }
    expect(rescuePenaltyCents(4400, 72 * H)).toBe(1000); // plancher
    expect(rescuePenaltyCents(4400, 12 * H)).toBe(2500); // moitié de 50 €
  });
  it("les sanctions montent avec la récidive : 48 h, 7 jours, examen", () => {
    expect(sanctionFor(0)).toBe("NONE");
    expect(sanctionFor(2.5)).toBe("NONE");
    expect(sanctionFor(3)).toBe("SUSPEND_48H");
    expect(sanctionFor(4)).toBe("SUSPEND_7D");
    expect(sanctionFor(5)).toBe("REVIEW");
    expect(sanctionFor(9)).toBe("REVIEW");
  });
});
