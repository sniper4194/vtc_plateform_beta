import { describe, expect, it, vi } from "vitest";
import { cancellationMessage, driverCompensationCents } from "./bookings.service";
import { acceptanceMessage, passengerAlertSms, priceLines, trackingMessage } from "./messages";
import { emailProviderFromEnv, ResendEmailProvider } from "./email";

const ride = {
  ref: 100234, pickupAt: new Date("2026-11-20T21:37:00Z"), pickupAddress: "Aéroport Charles de Gaulle (CDG)", dropoffAddress: "Hôtel Paris 13, Ivry-sur-Seine",
  category: "BERLINE", flatRateId: "cdg-paris" as string | null, priceCents: 6124, commissionCents: 1948, driverNetCents: 4176, driverCapCents: 4176, flightBufferMin: 15,
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

describe("message avec échelle de prix", () => {
  // Cas de la confirmation Sixt : client 61,24 €, plafond 41,76 €, accepté 36,19 €
  const laddered = { ...ride, driverCapCents: 4176, driverNetCents: 3619, commissionCents: 6124 - 3619 };
  it("montre client, plafond et prix accepté quand le prix accepté est inférieur au plafond", () => {
    const body = acceptanceMessage(laddered, "DL224").body;
    expect(body).toMatch(/Prix client \(TTC\) : 61,24\s€/);
    expect(body).toMatch(/Prix partenaire prévisionnel \(plafond\) : 41,76\s€/);
    expect(body).toMatch(/Prix partenaire accepté \(votre rémunération\) : 36,19\s€/);
    expect(body).not.toContain("Commission");
  });
  it("sans écart, retombe sur client / commission / net", () => {
    expect(priceLines({ ...laddered, driverNetCents: 4176, commissionCents: 1948 }, true)).toHaveLength(3);
    expect(priceLines({ ...laddered, driverNetCents: 4176, commissionCents: 1948 }, true)[1]).toContain("Commission");
  });
  it("masqué : seule la rémunération acceptée est montrée, plafond compris", () => {
    const lines = priceLines(laddered, false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/36,19/);
    expect(lines.join()).not.toMatch(/41,76|61,24/);
  });
});

describe("fournisseur e-mail", () => {
  it("Resend : appel REST avec clé, expéditeur et destinataire", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await new ResendEmailProvider("re_key", "CliCab <noreply@exemple.fr>", f as any).send({ to: "a@b.fr", subject: "Sujet", text: "Corps" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_key");
    expect(JSON.parse(init.body)).toEqual({ from: "CliCab <noreply@exemple.fr>", to: ["a@b.fr"], subject: "Sujet", text: "Corps" });
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

describe("message du lien de suivi au voyageur", () => {
  const b = { firstName: "Ana", reference: "R-100234", pickupAt: new Date("2026-11-20T21:37:00Z"), pickup: "CDG T2", dropoff: "Paris 8e", url: "https://suivi.exemple.fr/suivi/abc" };
  it("français : SMS court avec le lien, e-mail détaillé et mise en garde", () => {
    const m = trackingMessage({ ...b, language: "fr" }, "CliCab");
    expect(m.sms).toContain("R-100234");
    expect(m.sms).toContain("https://suivi.exemple.fr/suivi/abc");
    expect(m.sms).toContain("20/11 22:37"); // heure de Paris
    expect(m.sms.length).toBeLessThan(160);
    expect(m.text).toContain("CDG T2");
    expect(m.text).toMatch(/Ne partagez pas ce lien/);
  });
  it("toute autre langue : anglais", () => {
    const m = trackingMessage({ ...b, language: "pt" }, "CliCab");
    expect(m.subject).toBe("Your ride R-100234 is confirmed");
    expect(m.text).toMatch(/do not share this link/);
  });
});

describe("alertes SMS au voyageur", () => {
  it("chauffeur arrivé : prénom, véhicule, plaque et lien", () => {
    const m = passengerAlertSms({ kind: "ARRIVED", language: "fr", driverFirstName: "Hamza", vehicle: "Toyota Camry", plate: "GH-156-RM", url: "https://s/x" }, "CliCab");
    expect(m).toContain("Hamza");
    expect(m).toContain("Toyota Camry GH-156-RM");
    expect(m).toContain("https://s/x");
  });
  it("retard de vol : durée et nouvelle heure de prise en charge (heure de Paris), en anglais hors français", () => {
    const base = { kind: "FLIGHT_DELAY" as const, flightNumber: "AF1234", delayMin: 40, pickupAt: new Date("2026-11-20T21:37:00Z"), url: "https://s/x" };
    expect(passengerAlertSms({ ...base, language: "fr" }, "CliCab")).toMatch(/vol AF1234 retardé de 40 min.*22:37/);
    expect(passengerAlertSms({ ...base, language: "en" }, "CliCab")).toMatch(/flight AF1234 delayed by 40 min/);
  });
});
