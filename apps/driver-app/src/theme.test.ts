import { describe, expect, it } from "vitest";
import { applyTheme, c, PALETTES, parseTheme } from "./theme";

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
