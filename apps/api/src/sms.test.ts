import { describe, expect, it, vi } from "vitest";
import { normalizePhone } from "./phone";
import { smsProviderFromEnv, TwilioSmsProvider } from "./sms";

describe("numéros de téléphone", () => {
  it("normalise en E.164", () => {
    expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("06.12.34.56.78")).toBe("+33612345678");
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("0033612345678")).toBe("+33612345678");
    expect(normalizePhone("+351 912 345 678")).toBe("+351912345678");
  });
  it("refuse l'invalide", () => {
    for (const bad of ["", "abc", "+0123456789", "12345", "06 12 34", "+33612345678901234567"]) expect(normalizePhone(bad)).toBeNull();
  });
});

describe("fournisseur Twilio", () => {
  it("poste le message avec authentification Basic, expéditeur et corps encodés", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await new TwilioSmsProvider("ACxxx", "tok", { from: "CliCab" }, f as any).send("+33612345678", "Votre code : 123456");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json");
    expect(init.headers.authorization).toBe("Basic " + Buffer.from("ACxxx:tok").toString("base64"));
    const body = init.body as URLSearchParams;
    expect(body.get("To")).toBe("+33612345678");
    expect(body.get("From")).toBe("CliCab");
    expect(body.get("Body")).toBe("Votre code : 123456");
  });
  it("préfère le service de messagerie et signale les erreurs", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const p = new TwilioSmsProvider("AC", "t", { from: "X", messagingServiceSid: "MG1" }, f as any);
    await expect(p.send("+33612345678", "x")).rejects.toThrow(/401/);
    const body = f.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("MessagingServiceSid")).toBe("MG1");
    expect(body.has("From")).toBe(false);
  });
});

describe("choix du fournisseur", () => {
  it("console en dev, aucun en production sans configuration", () => {
    expect(smsProviderFromEnv({ NODE_ENV: "development" } as any)).not.toBeNull();
    expect(smsProviderFromEnv({ NODE_ENV: "production" } as any)).toBeNull();
    expect(smsProviderFromEnv({ NODE_ENV: "production", SMS_PROVIDER: "console" } as any)).toBeNull(); // jamais de console en production
  });
  it("Twilio exige une configuration complète", () => {
    expect(() => smsProviderFromEnv({ SMS_PROVIDER: "twilio" } as any)).toThrow();
    expect(smsProviderFromEnv({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "CliCab" } as any)).toBeInstanceOf(TwilioSmsProvider);
  });
});
