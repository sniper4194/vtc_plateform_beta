import { describe, expect, it, vi } from "vitest";
import { cancellationMessage, driverCompensationCents } from "./bookings.service";
import { acceptanceMessage, priceLines } from "./messages";
import { emailProviderFromEnv, ResendEmailProvider } from "./email";

const ride = {
  ref: 100234, pickupAt: new Date("2026-11-20T21:37:00Z"), pickupAddress: "Aéroport Charles de Gaulle (CDG)", dropoffAddress: "Hôtel Paris 13, Ivry-sur-Seine",
  category: "BERLINE", flatRateId: "cdg-paris" as string | null, priceCents: 6124, commissionCents: 1948, driverNetCents: 4176, flightBufferMin: 15,
};

describe("indemnité d'annulation du chauffeur", () => {
  it("frais moins la commission de la plateforme", () => {
    expect(driverCompensationCents(2750, { priceCents: 5500, commissionCents: 1100 })).toBe(2200);
    expect(driverCompensationCents(5500, { priceCents: 5500, commissionCents: 1100 })).toBe(4400);
  });
  it("rien si pas de frais ou prix nul", () => {
    expect(driverCompensationCents(0, { priceCents: 5500, commissionCents: 1100 })).toBe(0);
    expect(driverCompensationCents(100, { priceCents: 0, commissionCents: 0 })).toBe(0);
  });
  it("les centimes restent entiers et le total reste cohérent", () => {
    const comp = driverCompensationCents(3333, { priceCents: 7777, commissionCents: 1555 });
    expect(Number.isInteger(comp)).toBe(true);
    expect(comp).toBeGreaterThan(0);
    expect(comp).toBeLessThan(3333);
  });
});

describe("message d'annulation", () => {
  it("détaille la mission, le vol et l'indemnité (heures de Paris)", () => {
    const m = cancellationMessage(ride, "AY1581", 2200);
    expect(m.title).toBe("Mission R-100234 annulée");
    expect(m.body).toContain("R-100234");
    expect(m.body).toContain("20/11/2026 22:37"); // 21:37 UTC = 22:37 à Paris
    expect(m.body).toContain("atterrissage prévu à 22:22"); // 15 min avant la prise en charge
    expect(m.body).toContain("AY1581");
    expect(m.body).toContain("Berline · course au forfait");
    expect(m.body).toMatch(/Indemnité d'annulation : 22,00\s€/);
    expect(m.body).toContain("Vous n'êtes plus tenu");
  });
  it("sans vol ni indemnité", () => {
    const m = cancellationMessage({ ...ride, flatRateId: null }, null, 0);
    expect(m.body).not.toContain("Vol :");
    expect(m.body).toContain("Aucune indemnité d'annulation n'est due.");
    expect(m.body).not.toContain("forfait");
  });
});

describe("message de confirmation", () => {
  it("reprend les rubriques d'une confirmation de course, avec le détail du prix", () => {
    const m = acceptanceMessage(ride, "DL224");
    expect(m.title).toBe("Mission R-100234 confirmée");
    expect(m.body).toContain("Vous avez accepté la mission R-100234 :");
    expect(m.body).toContain("DL224");
    expect(m.body).toMatch(/Prix client \(TTC\) : 61,24\s€/);
    expect(m.body).toMatch(/Commission de la plateforme : 19,48\s€/);
    expect(m.body).toMatch(/Votre rémunération \(net\) : 41,76\s€/);
    expect(m.body).toContain("application chauffeur");
  });
  it("attribution par le dispatch : formulation différente", () => {
    const m = acceptanceMessage(ride, null, true);
    expect(m.title).toBe("Mission R-100234 attribuée");
    expect(m.body).toContain("Le dispatch vous a attribué la mission R-100234 :");
    expect(m.body).not.toContain("Vol :");
  });
  it("prix client masquable", () => {
    expect(priceLines(ride, false)).toHaveLength(1);
    expect(priceLines(ride, false)[0]).toMatch(/41,76/);
    expect(priceLines(ride, true)).toHaveLength(3);
    // la rémunération = prix client − commission, au centime près
    expect(ride.priceCents - ride.commissionCents).toBe(ride.driverNetCents);
  });
});

describe("fournisseur e-mail", () => {
  it("Resend : appel REST avec clé, expéditeur et destinataire", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await new ResendEmailProvider("re_key", "Étoile <noreply@exemple.fr>", f as any).send({ to: "a@b.fr", subject: "Sujet", text: "Corps" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_key");
    expect(JSON.parse(init.body)).toEqual({ from: "Étoile <noreply@exemple.fr>", to: ["a@b.fr"], subject: "Sujet", text: "Corps" });
  });
  it("signale les erreurs HTTP", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(new ResendEmailProvider("k", "f", f as any).send({ to: "a@b.fr", subject: "s", text: "t" })).rejects.toThrow(/403/);
  });
  it("choix du fournisseur : console en dev, aucun en production sans configuration", () => {
    expect(emailProviderFromEnv({ NODE_ENV: "development" } as any)).not.toBeNull();
    expect(emailProviderFromEnv({ NODE_ENV: "production" } as any)).toBeNull();
    expect(emailProviderFromEnv({ NODE_ENV: "production", EMAIL_PROVIDER: "console" } as any)).toBeNull();
    expect(() => emailProviderFromEnv({ EMAIL_PROVIDER: "resend" } as any)).toThrow();
    expect(emailProviderFromEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "x@y.fr" } as any)).toBeInstanceOf(ResendEmailProvider);
  });
});
