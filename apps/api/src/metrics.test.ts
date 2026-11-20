import { describe, expect, it } from "vitest";
import { csvCell, daysBetween, dayKeyTz, deltaPct, effectivePickup, pct, punctuality } from "./metrics";

const t = (s: string) => new Date(s);

describe("ponctualité", () => {
  const pickup = t("2026-11-21T10:00:00Z");
  it("à l'heure ou en avance : parfaite", () => {
    expect(punctuality(t("2026-11-21T09:50:00Z"), pickup)).toBe("PERFECT");
    expect(punctuality(t("2026-11-21T10:00:00Z"), pickup)).toBe("PERFECT");
  });
  it("jusqu'à 15 min de retard : moyenne ; au-delà : mauvaise", () => {
    expect(punctuality(t("2026-11-21T10:15:00Z"), pickup)).toBe("AVERAGE");
    expect(punctuality(t("2026-11-21T10:16:00Z"), pickup)).toBe("POOR");
  });
  it("jamais arrivé : mauvaise", () => expect(punctuality(null, pickup)).toBe("POOR"));
  it("un vol retardé repousse l'heure de référence", () => {
    const eff = effectivePickup(pickup, 62);
    expect(eff.toISOString()).toBe("2026-11-21T11:02:00.000Z");
    expect(punctuality(t("2026-11-21T10:50:00Z"), eff)).toBe("PERFECT"); // arrivé avant le vol, pas de pénalité
    expect(punctuality(t("2026-11-21T10:50:00Z"), pickup)).toBe("POOR"); // sans la prise en compte du retard
  });
});

describe("statistiques", () => {
  it("pourcentages et variations", () => {
    expect(pct(9, 10)).toBe(90);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
    expect(deltaPct(397, 478)).toBe(-16.9);
    expect(deltaPct(10, 0)).toBeNull();
  });
  it("jours au fuseau de Paris (23h30 UTC = lendemain à Paris)", () => {
    expect(dayKeyTz(t("2026-11-20T23:30:00Z"))).toBe("2026-11-21");
  });
  it("liste de jours continue", () => {
    const d = daysBetween(t("2026-11-14T23:00:00Z"), t("2026-11-21T23:00:00Z"));
    expect(d[0]).toBe("2026-11-15");
    expect(d[d.length - 1]).toBe("2026-11-21");
    expect(d).toHaveLength(7);
  });
});

describe("CSV", () => {
  it("échappe et neutralise les formules", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });
});
