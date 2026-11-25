import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";

describe("mots de passe", () => {
  it("hache avec un sel aléatoire et vérifie", async () => {
    const a = await hashPassword("correct horse battery"), b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt:16384:8:1:")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterz", a)).toBe(false);
  });
  it("refuse une empreinte altérée ou d'un autre format", async () => {
    const h = await hashPassword("un-mot-de-passe-long");
    expect(await verifyPassword("un-mot-de-passe-long", h.slice(0, -4) + "AAAA")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:abc")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
  it("politique : 12 caractères, pas l'identifiant", () => {
    expect(passwordProblem("court")).toMatch(/12/);
    expect(passwordProblem("hamza-belhiba-2026", "hamza@x.fr")).toMatch(/identifiant/);
    expect(passwordProblem("un-phrase-de-passe-solide", "hamza@x.fr")).toBeNull();
  });
});
