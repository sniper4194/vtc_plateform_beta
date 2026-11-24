import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}

/** Développement : écrit le message dans les journaux au lieu de l'envoyer. Ne jamais l'utiliser en production. */
export class ConsoleSmsProvider implements SmsProvider {
  private log = new Logger("sms");
  async send(to: string, text: string) { this.log.log(`SMS → ${to} : ${text}`); }
}

/**
 * Twilio (API REST Messages). Variables : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, et TWILIO_FROM (numéro ou nom d'expéditeur)
 * ou TWILIO_MESSAGING_SERVICE_SID. Écrit d'après la documentation publique ; non essayé contre un vrai compte.
 */
export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private sid: string, private token: string, private sender: { from?: string; messagingServiceSid?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(to: string, text: string) {
    const body = new URLSearchParams({ To: to, Body: text });
    if (this.sender.messagingServiceSid) body.set("MessagingServiceSid", this.sender.messagingServiceSid);
    else if (this.sender.from) body.set("From", this.sender.from);
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.sid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${this.sid}:${this.token}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
  }
}

/**
 * OVHcloud (API REST, `POST /sms/{service}/jobs`). Variables : OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY, OVH_SMS_SERVICE (nom du compte SMS,
 * du type `sms-ab12345-1`), et OVH_SMS_SENDER (expéditeur validé par OVHcloud ; sans lui, le numéro court par défaut est utilisé).
 * Chaque appel est signé : `$1$` + SHA-1 de `secret+consommateur+méthode+URL+corps+horodatage`, l'horodatage étant celui du serveur OVHcloud.
 * Écrit d'après la documentation et des clients publics ; non essayé contre un vrai compte.
 */
export class OvhSmsProvider implements SmsProvider {
  private delta: number | null = null; // écart entre l'horloge d'OVHcloud et la nôtre
  constructor(
    private cfg: { appKey: string; appSecret: string; consumerKey: string; service: string; sender?: string; endpoint?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}
  private get base() { return (this.cfg.endpoint ?? "https://eu.api.ovh.com/1.0").replace(/\/+$/, ""); }
  private async now() {
    if (this.delta === null) {
      const res = await this.fetchImpl(`${this.base}/auth/time`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`OVHcloud HTTP ${res.status} (heure du serveur)`);
      this.delta = Number(await res.text()) - Math.round(Date.now() / 1000);
    }
    return Math.round(Date.now() / 1000) + this.delta;
  }
  async send(to: string, text: string) {
    const url = `${this.base}/sms/${encodeURIComponent(this.cfg.service)}/jobs`;
    // noStopClause : sans cela, OVHcloud ajoute « STOP au 36184 » (mention des messages commerciaux) ; ici ce sont des messages de service.
    const body = JSON.stringify({
      message: text, receivers: [to], charset: "UTF-8", priority: "high", noStopClause: true,
      ...(this.cfg.sender ? { sender: this.cfg.sender } : { senderForResponse: true }),
    });
    const ts = await this.now();
    const signature = "$1$" + createHash("sha1").update([this.cfg.appSecret, this.cfg.consumerKey, "POST", url, body, ts].join("+")).digest("hex");
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-ovh-application": this.cfg.appKey, "x-ovh-consumer": this.cfg.consumerKey,
        "x-ovh-timestamp": String(ts), "x-ovh-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) this.delta = null; // horloge ou jeton : on la relira au prochain envoi
      throw new Error(`OVHcloud HTTP ${res.status}`);
    }
  }
}

/**
 * Infobip (`POST {base}/sms/2/text/advanced`, en-tête `Authorization: App <clé>`). Variables : INFOBIP_BASE_URL (adresse personnelle
 * affichée dans le portail, du type `xxxxx.api.infobip.com`), INFOBIP_API_KEY, INFOBIP_FROM (expéditeur ; en essai gratuit, celui imposé par Infobip).
 * Écrit d'après les exemples publiés par Infobip (le site de documentation n'était pas joignable) ; non essayé contre un vrai compte.
 */
export class InfobipSmsProvider implements SmsProvider {
  constructor(private cfg: { baseUrl: string; apiKey: string; from?: string }, private fetchImpl: typeof fetch = fetch) {}
  private get base() { return ("https://" + this.cfg.baseUrl.replace(/^https?:\/\//, "")).replace(/\/+$/, ""); }
  async send(to: string, text: string) {
    const res = await this.fetchImpl(`${this.base}/sms/2/text/advanced`, {
      method: "POST",
      headers: { authorization: `App ${this.cfg.apiKey}`, "content-type": "application/json", accept: "application/json" },
      // Numéro au format international ; les exemples d'Infobip l'écrivent sans « + ».
      body: JSON.stringify({ messages: [{ destinations: [{ to: to.replace(/^\+/, "") }], ...(this.cfg.from ? { from: this.cfg.from } : {}), text }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Infobip HTTP ${res.status}`);
    // Une réponse 200 peut porter un refus par message (numéro non autorisé en essai, expéditeur refusé…).
    const j: any = await res.json().catch(() => null);
    const st = j?.messages?.[0]?.status;
    if (st?.groupName === "REJECTED") throw new Error(`Infobip refusé : ${st.name ?? ""} ${st.description ?? ""}`.trim());
  }
}

export function smsProviderFromEnv(env = process.env): SmsProvider | null {
  const kind = env.SMS_PROVIDER ?? (env.NODE_ENV === "production" ? "" : "console");
  if (kind === "console") return env.NODE_ENV === "production" ? null : new ConsoleSmsProvider();
  if (kind === "twilio") {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !(env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)) throw new Error("Configuration Twilio incomplète");
    return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, { from: env.TWILIO_FROM, messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID });
  }
  if (kind === "ovh") {
    if (!env.OVH_APP_KEY || !env.OVH_APP_SECRET || !env.OVH_CONSUMER_KEY || !env.OVH_SMS_SERVICE) throw new Error("Configuration OVHcloud incomplète (OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY, OVH_SMS_SERVICE)");
    return new OvhSmsProvider({ appKey: env.OVH_APP_KEY, appSecret: env.OVH_APP_SECRET, consumerKey: env.OVH_CONSUMER_KEY, service: env.OVH_SMS_SERVICE, sender: env.OVH_SMS_SENDER || undefined, endpoint: env.OVH_ENDPOINT || undefined });
  }
  if (kind === "infobip") {
    if (!env.INFOBIP_BASE_URL || !env.INFOBIP_API_KEY) throw new Error("Configuration Infobip incomplète (INFOBIP_BASE_URL, INFOBIP_API_KEY)");
    return new InfobipSmsProvider({ baseUrl: env.INFOBIP_BASE_URL, apiKey: env.INFOBIP_API_KEY, from: env.INFOBIP_FROM || undefined });
  }
  return null;
}

@Injectable()
export class SmsService {
  provider: SmsProvider | null = smsProviderFromEnv();
}
