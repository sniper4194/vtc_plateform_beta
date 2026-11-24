import { Catch, ArgumentsHost, HttpException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";

/**
 * Suivi des erreurs sans service tiers : chaque erreur grave est écrite dans les journaux et, si ERROR_WEBHOOK_URL est définie,
 * envoyée à ce lien (Slack, Discord ou Mattermost : le message est un simple `{ "text": "…" }`).
 * Un même message n'est envoyé qu'une fois par fenêtre (ERROR_DEDUPE_MIN, 10 minutes par défaut) pour ne pas noyer l'équipe.
 * Aucun contenu de requête, jeton ni donnée personnelle n'est transmis : source, message, trace courte, et le contexte fourni.
 */
export interface ErrorReport { source: string; message: string; stack?: string; context?: Record<string, string | number | null | undefined> }

export function formatReport(r: ErrorReport): string {
  const ctx = Object.entries(r.context ?? {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${v}`).join(" · ");
  const stack = (r.stack ?? "").split("\n").slice(0, 4).join("\n");
  return [`⚠ CliCab [${r.source}] ${r.message}`.slice(0, 400), ctx, stack].filter(Boolean).join("\n").slice(0, 1500);
}

@Injectable()
export class ErrorReporter {
  private log = new Logger("erreurs");
  private seen = new Map<string, number>();
  // Champs (et non paramètres de constructeur) : l'injection de Nest ne sait pas résoudre des valeurs par défaut ; les tests les remplacent.
  env: NodeJS.ProcessEnv = process.env;
  fetchImpl: typeof fetch = (...a) => fetch(...a);

  /** Renvoie true si le message a été envoyé au lien d'alerte (faux : doublon récent, ou aucun lien configuré). */
  async report(r: ErrorReport, now = Date.now()): Promise<boolean> {
    this.log.error(formatReport(r));
    const url = this.env.ERROR_WEBHOOK_URL;
    if (!url) return false;
    const windowMs = (Number(this.env.ERROR_DEDUPE_MIN) || 10) * 60_000;
    const key = `${r.source}:${r.message.slice(0, 200)}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    this.seen.set(key, now);
    if (this.seen.size > 500) for (const [k, t] of this.seen) if (now - t > windowMs) this.seen.delete(k);
    try {
      const res = await this.fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: formatReport(r) }), signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch { return false; } // le suivi ne doit jamais faire tomber l'application
  }
}

/** Filtre global : les erreurs 5xx sont signalées, les erreurs normales (401, 404, 422…) ne le sont pas. */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(@Inject(ErrorReporter) private reporter: ErrorReporter) { super(); }
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest?.() ?? {};
      const e = exception as Error;
      void this.reporter.report({ source: "api", message: e?.message ?? String(exception), stack: e?.stack, context: { route: `${req.method ?? ""} ${String(req.route?.path ?? req.url ?? "").split("?")[0]}`.trim(), status } });
    }
    super.catch(exception, host);
  }
}
