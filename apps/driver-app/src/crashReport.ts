import { Platform } from "react-native";
import { api } from "./api";
import app from "../app.json";

/** Corps du rapport envoyé au serveur : message et trace tronqués (le serveur refuse les textes trop longs). */
export function crashPayload(error: unknown, label?: string, fatal = false) {
  const e = error as { message?: unknown; stack?: unknown } | null;
  return {
    ...(label ? { label: label.slice(0, 60) } : {}),
    message: (String(e?.message ?? error ?? "Erreur inconnue") || "Erreur inconnue").slice(0, 500),
    ...(e?.stack ? { stack: String(e.stack).slice(0, 2000) } : {}),
    platform: Platform.OS, appVersion: String(app.expo.version).slice(0, 20), fatal,
  };
}

let sending = false;
/** Signale un plantage à l'équipe. Silencieux : un échec d'envoi (hors ligne, pas connecté) ne doit jamais aggraver le problème. */
export function reportCrash(error: unknown, label?: string, fatal = false) {
  if (sending) return; // évite une boucle si l'envoi lui-même échoue
  sending = true;
  api("/driver/client-error", crashPayload(error, label, fatal)).catch(() => {}).finally(() => { sending = false; });
}
