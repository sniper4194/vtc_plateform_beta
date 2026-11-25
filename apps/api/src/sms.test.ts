import { describe, expect, it, vi } from "vitest";
import { normalizePhone } from "./phone";
import { createHash } from "node:crypto";
import { InfobipSmsProvider, OvhSmsProvider, smsProviderFromEnv, TwilioSmsProvider } from "./sms";

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

describe("fournisseur OVHcloud", () => {
  const cfg = { appKey: "AK", appSecret: "AS", consumerKey: "CK", service: "sms-ab12345-1" };
  /** Réponses simulées : l'heure du serveur OVHcloud, puis la création de l'envoi. */
  const fetchMock = (serverTime: number, status = 200) =>
    vi.fn(async (url: string) => (String(url).endsWith("/auth/time") ? { ok: true, status: 200, text: async () => String(serverTime) } : { ok: status < 400, status }));

  it("signe la requête avec l'heure du serveur OVHcloud et envoie le message", async () => {
    const serverTime = Math.round(Date.now() / 1000) + 5000; // horloge locale en retard : la signature doit suivre celle d'OVHcloud
    const f = fetchMock(serverTime);
    await new OvhSmsProvider({ ...cfg, sender: "CliCab" }, f as any).send("+33612345678", "Votre code : 123456");
    expect(f.mock.calls[0][0]).toBe("https://eu.api.ovh.com/1.0/auth/time");
    const [url, init] = f.mock.calls[1] as any;
    expect(url).toBe("https://eu.api.ovh.com/1.0/sms/sms-ab12345-1/jobs");
    expect(init.method).toBe("POST");
    const ts = Number(init.headers["x-ovh-timestamp"]);
    expect(Math.abs(ts - serverTime)).toBeLessThanOrEqual(2);
    const expected = "$1$" + createHash("sha1").update(["AS", "CK", "POST", url, init.body, ts].join("+")).digest("hex");
    expect(init.headers["x-ovh-signature"]).toBe(expected);
    expect(init.headers["x-ovh-application"]).toBe("AK");
    expect(init.headers["x-ovh-consumer"]).toBe("CK");
    expect(JSON.parse(init.body)).toEqual({ message: "Votre code : 123456", receivers: ["+33612345678"], charset: "UTF-8", priority: "high", noStopClause: true, sender: "CliCab" });
  });
  it("sans expéditeur validé, utilise le numéro court par défaut (jamais les deux à la fois)", async () => {
    const f = fetchMock(Math.round(Date.now() / 1000));
    await new OvhSmsProvider(cfg, f as any).send("+33612345678", "x");
    const body = JSON.parse((f.mock.calls[1] as any)[1].body);
    expect(body.senderForResponse).toBe(true);
    expect(body).not.toHaveProperty("sender");
  });
  it("lit l'heure du serveur une seule fois, la relit après un refus, et signale l'erreur", async () => {
    const f = fetchMock(Math.round(Date.now() / 1000));
    const p = new OvhSmsProvider(cfg, f as any);
    await p.send("+33612345678", "a"); await p.send("+33612345678", "b");
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith("/auth/time"))).toHaveLength(1);
    const bad = fetchMock(Math.round(Date.now() / 1000), 403);
    const q = new OvhSmsProvider(cfg, bad as any);
    await expect(q.send("+33612345678", "x")).rejects.toThrow(/403/);
    await expect(q.send("+33612345678", "x")).rejects.toThrow(/403/);
    expect(bad.mock.calls.filter((c) => String(c[0]).endsWith("/auth/time"))).toHaveLength(2);
  });
  it("exige une configuration complète", () => {
    expect(() => smsProviderFromEnv({ SMS_PROVIDER: "ovh" } as any)).toThrow(/OVHcloud/);
    const env = { SMS_PROVIDER: "ovh", OVH_APP_KEY: "a", OVH_APP_SECRET: "b", OVH_CONSUMER_KEY: "c", OVH_SMS_SERVICE: "sms-x-1" } as any;
    expect(smsProviderFromEnv(env)).toBeInstanceOf(OvhSmsProvider);
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

describe("fournisseur Infobip", () => {
  it("poste sur l'adresse personnelle avec la clé « App », numéro international sans +", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ status: { groupName: "PENDING" } }] }) });
    await new InfobipSmsProvider({ baseUrl: "https://abc12.api.infobip.com/", apiKey: "k1", from: "CliCab" }, f as any).send("+33612345678", "Votre code : 123456");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://abc12.api.infobip.com/sms/2/text/advanced");
    expect(init.headers.authorization).toBe("App k1");
    expect(JSON.parse(init.body)).toEqual({ messages: [{ destinations: [{ to: "33612345678" }], from: "CliCab", text: "Votre code : 123456" }] });
    // adresse saisie sans https://
    await new InfobipSmsProvider({ baseUrl: "abc12.api.infobip.com", apiKey: "k1" }, f as any).send("+33612345678", "x");
    expect(f.mock.calls[1][0]).toBe("https://abc12.api.infobip.com/sms/2/text/advanced");
    expect(JSON.parse(f.mock.calls[1][1].body).messages[0].from).toBeUndefined();
  });
  it("signale les erreurs HTTP et les refus par message", async () => {
    const p401 = new InfobipSmsProvider({ baseUrl: "x.api.infobip.com", apiKey: "k" }, vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any);
    await expect(p401.send("+33612345678", "x")).rejects.toThrow(/401/);
    const rej = new InfobipSmsProvider({ baseUrl: "x.api.infobip.com", apiKey: "k" }, vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ status: { groupName: "REJECTED", name: "REJECTED_DESTINATION", description: "not whitelisted" } }] }) }) as any);
    await expect(rej.send("+33612345678", "x")).rejects.toThrow(/REJECTED_DESTINATION/);
  });
  it("se configure par l'environnement", () => {
    expect(smsProviderFromEnv({ SMS_PROVIDER: "infobip", INFOBIP_BASE_URL: "x.api.infobip.com", INFOBIP_API_KEY: "k" } as any)).toBeInstanceOf(InfobipSmsProvider);
    expect(() => smsProviderFromEnv({ SMS_PROVIDER: "infobip", INFOBIP_API_KEY: "k" } as any)).toThrow(/INFOBIP_BASE_URL/);
  });
});
