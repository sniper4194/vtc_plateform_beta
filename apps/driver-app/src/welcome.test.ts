import { describe, expect, it } from "vitest";
import { welcomeCard, welcomeLang } from "./welcome";

describe("carte de bienvenue traduite", () => {
  it("choisit la langue du voyageur, ou l'anglais à défaut", () => {
    expect(welcomeLang("pt")).toBe("pt");
    expect(welcomeLang("pt-BR")).toBe("pt");
    expect(welcomeLang("DE")).toBe("de");
    expect(welcomeLang("ja")).toBe("en");
    expect(welcomeLang(null)).toBe("en");
    expect(welcomeLang("fr")).toBe("fr");
  });
  it("insère le prénom et la durée, avec la traduction française pour le chauffeur", () => {
    const c = welcomeCard("es", "Lucía", 42.4);
    expect(c.languageName).toBe("Español");
    expect(c.lines[0]).toBe("¡Hola, Lucía! Le damos la bienvenida.");
    expect(c.lines[2]).toBe("El trayecto dura unos 42 minutos.");
    expect(c.french[2]).toBe("Le trajet dure environ 42 minutes.");
    expect(c.lines).toHaveLength(c.french.length);
  });
});
