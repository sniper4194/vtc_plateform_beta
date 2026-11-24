import { describe, expect, it } from "vitest";
import { addressLines, coordsLabel, formatStampDate, stampHeader, stampLines } from "./proofFormat";

describe("cachet des photos-preuves", () => {
  it("formate la date et l'heure à la française, à l'heure de Paris", () => {
    expect(formatStampDate(new Date("2026-11-24T10:50:35Z"))).toBe("24 nov. 2026 11:50:35"); // UTC+1 en novembre
    expect(formatStampDate(new Date("2026-07-02T10:05:09Z"))).toBe("2 juil. 2026 12:05:09"); // UTC+2 en été
  });
  it("découpe l'adresse en lignes courtes", () => {
    expect(addressLines("104 Rue Henri Gautier, Bobigny, Seine-Saint-Denis, Île-de-France")).toEqual(["104 Rue Henri Gautier", "Bobigny", "Seine-Saint-Denis", "Île-de-France"]);
    expect(addressLines(null)).toEqual([]);
    expect(addressLines(" , ")).toEqual([]);
  });
  it("affiche les coordonnées avec la précision, ou indique l'absence de position", () => {
    expect(coordsLabel(49.0097, 2.5479, 8.4)).toBe("49.00970, 2.54790 (±8 m)");
    expect(coordsLabel(49.0097, 2.5479)).toBe("49.00970, 2.54790");
    expect(coordsLabel(null, null)).toBe("Position indisponible");
  });
  it("assemble le cachet : date, adresse, coordonnées", () => {
    const lines = stampLines({ at: new Date("2026-11-24T10:50:35Z"), lat: 48.9, lng: 2.4, accuracyM: 12, address: "104 Rue Henri Gautier, Bobigny" });
    expect(lines).toEqual(["24 nov. 2026 11:50:35", "104 Rue Henri Gautier", "Bobigny", "48.90000, 2.40000 (±12 m)"]);
  });
  it("nomme la mission et la nature de la preuve", () => {
    expect(stampHeader({ ref: "R-000123", kind: "NO_SHOW" })).toBe("CliCab · R-000123 · Client absent");
    expect(stampHeader({})).toBe("CliCab");
  });
});
