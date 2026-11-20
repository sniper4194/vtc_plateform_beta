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

export function smsProviderFromEnv(env = process.env): SmsProvider | null {
  const kind = env.SMS_PROVIDER ?? (env.NODE_ENV === "production" ? "" : "console");
  if (kind === "console") return env.NODE_ENV === "production" ? null : new ConsoleSmsProvider();
  if (kind === "twilio") {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !(env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)) throw new Error("Configuration Twilio incomplète");
    return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, { from: env.TWILIO_FROM, messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID });
  }
  return null;
}

@Injectable()
export class SmsService {
  provider: SmsProvider | null = smsProviderFromEnv();
}
