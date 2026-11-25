import { Injectable, Logger } from "@nestjs/common";

export interface EmailMessage { to: string; subject: string; text: string }
export interface EmailProvider { send(m: EmailMessage): Promise<void> }

/** Développement : écrit le message dans les journaux. */
export class ConsoleEmailProvider implements EmailProvider {
  private log = new Logger("email");
  async send(m: EmailMessage) { this.log.log(`E-mail → ${m.to} : ${m.subject}`); }
}

/** Resend (API REST `POST /emails`). Écrit d'après la documentation publique ; non essayé contre un vrai compte. */
export class ResendEmailProvider implements EmailProvider {
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(m: EmailMessage) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
  }
}

export function emailProviderFromEnv(env = process.env): EmailProvider | null {
  const kind = env.EMAIL_PROVIDER ?? (env.NODE_ENV === "production" ? "" : "console");
  if (kind === "console") return env.NODE_ENV === "production" && env.APP_ENV !== "staging" ? null : new ConsoleEmailProvider();
  if (kind === "resend") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Configuration Resend incomplète (RESEND_API_KEY, EMAIL_FROM)");
    return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  return null;
}

@Injectable()
export class EmailService {
  provider: EmailProvider | null = emailProviderFromEnv();
}
