import { describe, expect, it } from "vitest";
import { parseSiteTheme, themeBootScript } from "./theme";

describe("thème des pages publiques", () => {
  it("prend « Original » par défaut et n'accepte que « classique » comme alternative", () => {
    expect(parseSiteTheme("classique")).toBe("classique");
    expect(parseSiteTheme("original")).toBe("original");
    expect(parseSiteTheme(null)).toBe("original");
    expect(parseSiteTheme("sombre")).toBe("original");
  });
  it("le script de démarrage applique le thème enregistré, ou Original si le stockage est bloqué", () => {
    const run = (storage: { getItem: (k: string) => string | null }) => {
      const documentElement = { dataset: {} as Record<string, string> };
      new Function("document", "localStorage", themeBootScript)({ documentElement }, storage);
      return documentElement.dataset.theme;
    };
    expect(run({ getItem: () => "classique" })).toBe("classique");
    expect(run({ getItem: () => null })).toBe("original");
    expect(run({ getItem: () => { throw new Error("bloqué"); } })).toBe("original");
  });
});
