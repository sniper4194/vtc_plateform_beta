import { describe, expect, it } from "vitest";
import { CATEGORY, NEED, parisToIso, T } from "./hosted";

describe("heure de Paris", () => {
  it("convertit l'heure saisie (Paris) en UTC, été comme hiver", () => {
    expect(parisToIso("2026-07-10", "14:30")).toBe("2026-07-10T12:30:00.000Z"); // été : UTC+2
    expect(parisToIso("2026-12-10", "14:30")).toBe("2026-12-10T13:30:00.000Z"); // hiver : UTC+1
    expect(parisToIso("2026-12-10", "")).toBeNull();
  });
});

describe("textes", () => {
  it("français et anglais ont les mêmes clés", () => {
    expect(Object.keys(T.en).sort()).toEqual(Object.keys(T.fr).sort());
    expect(Object.keys(CATEGORY.en).sort()).toEqual(Object.keys(CATEGORY.fr).sort());
    expect(Object.keys(NEED.en).sort()).toEqual(Object.keys(NEED.fr).sort());
  });
});
