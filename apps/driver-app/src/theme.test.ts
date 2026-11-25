import { describe, expect, it } from "vitest";
import { applyTheme, c, font, PALETTES, parseTheme, parseThemeStyle } from "./theme";

describe("thème clair / sombre", () => {
  it("n'accepte que « dark » comme valeur sombre", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme("bleu")).toBe("light");
  });
  it("applyTheme change le fond et le texte, mais pas les couleurs de marque", () => {
    const { yel, red, cream, ink } = c;
    applyTheme("dark");
    expect(c.sky).toBe(PALETTES.dark.sky);
    expect(c.onSky).toBe(PALETTES.dark.onSky);
    expect({ yel: c.yel, red: c.red, cream: c.cream, ink: c.ink }).toEqual({ yel, red, cream, ink });
    applyTheme("light");
    expect(c.sky).toBe(PALETTES.light.sky);
  });
});

describe("styles d'affichage", () => {
  it("demande un choix tant qu'aucun style valide n'a été enregistré", () => {
    expect(parseThemeStyle("original")).toBe("original");
    expect(parseThemeStyle("classic")).toBe("classic");
    expect(parseThemeStyle("dark")).toBeNull();
    expect(parseThemeStyle(null)).toBeNull();
  });

  it("restitue la palette et les polices d'origine après un passage au thème Classique", () => {
    const original = { ...c };
    try {
      applyTheme("light", "classic");
      expect(c.cream).toBe("#fdf7e8");
      expect(font.slab).toBeUndefined();
      applyTheme("dark", "classic");
      expect(c.sky).toBe("#151827");
      expect(c.cream).toBe("#fdf7e8");
      applyTheme("light", "original");
      expect(c).toEqual(original);
      expect(font.slab).toBe("AlfaSlabOne_400Regular");
    } finally {
      applyTheme("light", "original");
    }
  });
});
