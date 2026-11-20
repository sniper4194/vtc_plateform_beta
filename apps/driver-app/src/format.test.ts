import { describe, expect, it } from "vitest";
import { countdown, eur, NEXT_ACTION, whenLabel } from "./format";

describe("format", () => {
  it("compte à rebours mm:ss", () => {
    expect(countdown(57)).toBe("00:57");
    expect(countdown(300)).toBe("05:00");
    expect(countdown(-3)).toBe("00:00");
  });
  it("libellé de date relatif", () => {
    const now = new Date(2026, 10, 20, 12, 0);
    expect(whenLabel(new Date(2026, 10, 21, 4, 10).toISOString(), now)).toBe("Demain à 04:10");
    expect(whenLabel(new Date(2026, 10, 20, 18, 5).toISOString(), now)).toBe("Aujourd'hui à 18:05");
  });
  it("montants en euros", () => expect(eur(4400).replace(/\s/g, " ")).toContain("44,00"));
  it("enchaîne les actions jusqu'à la fin", () => {
    expect(NEXT_ACTION.ASSIGNED?.action).toBe("en-route");
    expect(NEXT_ACTION.IN_PROGRESS?.action).toBe("complete");
    expect(NEXT_ACTION.COMPLETED).toBeUndefined();
  });
});
