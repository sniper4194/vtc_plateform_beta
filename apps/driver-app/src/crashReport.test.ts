import { describe, expect, it, vi } from "vitest";
import { crashPayload } from "./crashReport";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("./api", () => ({ api: vi.fn() }));

describe("rapport de plantage", () => {
  it("renseigne message, trace, plateforme, version et gravité", () => {
    const p = crashPayload(new TypeError("boum"), "Photo-preuve", true);
    expect(p).toMatchObject({ label: "Photo-preuve", message: "boum", platform: "android", fatal: true });
    expect(p.stack).toContain("TypeError");
    expect(p.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("tronque les textes trop longs et accepte une valeur qui n'est pas une erreur", () => {
    expect(crashPayload(new Error("x".repeat(900))).message).toHaveLength(500);
    expect(crashPayload("texte simple").message).toBe("texte simple");
    expect(crashPayload(null).message).toBe("Erreur inconnue");
    expect(crashPayload({ message: "" }).message).toBe("Erreur inconnue");
    const long = new Error("a"); long.stack = "s".repeat(5000);
    expect(crashPayload(long).stack).toHaveLength(2000);
  });
});
