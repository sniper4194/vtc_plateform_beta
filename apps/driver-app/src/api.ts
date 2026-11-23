import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { normalizeApiUrl } from "./format";

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const KEY = "driver_token";
const URL_KEY = "api_url";

// Adresse du serveur : celle compilée dans l'application, modifiable sur l'écran de connexion (utile pour un APK de test :
// on peut le pointer vers un PC du même Wi-Fi ou vers un tunnel sans recompiler).
let apiUrl = DEFAULT_API_URL;
export const getApiUrl = () => apiUrl;

let token: string | null = null;
// SecureStore n'existe pas sur le web (démo/dev) : repli sur sessionStorage.
const store = {
  get: async () => (Platform.OS === "web" ? globalThis.sessionStorage?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY)),
  set: async (v: string) => (Platform.OS === "web" ? globalThis.sessionStorage?.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v)),
  del: async () => (Platform.OS === "web" ? globalThis.sessionStorage?.removeItem(KEY) : SecureStore.deleteItemAsync(KEY)),
};
export async function loadApiUrl() {
  const saved = Platform.OS === "web" ? globalThis.localStorage?.getItem(URL_KEY) ?? null : await SecureStore.getItemAsync(URL_KEY);
  const ok = saved ? normalizeApiUrl(saved) : null;
  if (ok) apiUrl = ok;
  return apiUrl;
}
export async function saveApiUrl(raw: string) {
  const u = normalizeApiUrl(raw);
  if (!u) throw new Error("Adresse invalide : elle doit ressembler à http://192.168.1.20:3000 ou https://api.exemple.fr");
  apiUrl = u;
  if (Platform.OS === "web") globalThis.localStorage?.setItem(URL_KEY, u); else await SecureStore.setItemAsync(URL_KEY, u);
  return u;
}
export async function loadToken() {
  token = await store.get();
  return token;
}
export async function saveToken(t: string | null) {
  token = t;
  if (t) await store.set(t);
  else await store.del();
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Échec réseau (serveur éteint, mauvaise adresse, pare-feu, CORS) : on dit quelle adresse a été tentée, pour que l'on puisse diagnostiquer. */
export const unreachableMessage = () => `Serveur injoignable (${apiUrl}). Vérifiez que l'API tourne et que l'adresse est la bonne.`;

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(unreachableMessage(), 0, "NETWORK");
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(json?.message ?? `Erreur ${res.status}`, res.status, json?.code);
  return json as T;
}

/** Requête GET qui renvoie du texte (export CSV). */
export async function apiText(path: string): Promise<string> {
  let res: Response;
  try { res = await fetch(apiUrl + path, { headers: token ? { authorization: `Bearer ${token}` } : {} }); } catch { throw new ApiError(unreachableMessage(), 0, "NETWORK"); }
  const text = await res.text();
  if (!res.ok) { let m = `Erreur ${res.status}`; try { m = JSON.parse(text)?.message ?? m; } catch { /* texte brut */ } throw new ApiError(m, res.status); }
  return text;
}
