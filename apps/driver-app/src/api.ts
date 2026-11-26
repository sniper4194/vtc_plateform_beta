import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { normalizeApiUrl } from "./format";

const TEST_APP = process.env.EXPO_PUBLIC_CLICAB_TEST === "1";
const DEFAULT_API_URL = TEST_APP ? "https://api-test.clicab.fr" : process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const KEY = "driver_token";
const URL_KEY = "api_url";
const DEVICE_KEY="driver_device_v1", BIO_KEY="driver_bio_v1";
const bioOptions={requireAuthentication:true,keychainService:"clicab_biometric",authenticationPrompt:"Déverrouiller votre session CliCab"};
export const biometricUnavailableMessage =
  "Configurez une empreinte ou une reconnaissance faciale compatible dans les réglages de votre téléphone.";

export function biometricAvailable() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return false;
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

export class BiometricError extends Error {}

function requireBiometrics() {
  if (!biometricAvailable()) throw new BiometricError(biometricUnavailableMessage);
}

function biometricStorageError(error: unknown, failureMessage: string) {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (/cancel/i.test(String(code)) || /cancel/i.test(message)) {
    return new BiometricError("Authentification biométrique annulée.");
  }
  return new BiometricError(failureMessage);
}
export async function loadDevice(){return Platform.OS==="web"?null:SecureStore.getItemAsync(DEVICE_KEY);}
export async function saveDevice(v:string|null){if(Platform.OS==="web")return;if(v)await SecureStore.setItemAsync(DEVICE_KEY,v);else await SecureStore.deleteItemAsync(DEVICE_KEY);}
async function clearBio(){if(Platform.OS!=="web")await SecureStore.deleteItemAsync(BIO_KEY,bioOptions);}
export async function unlockBiometric() {
  requireBiometrics();
  let saved: string | null;
  try {
    saved = await SecureStore.getItemAsync(BIO_KEY, bioOptions);
  } catch (error) {
    throw biometricStorageError(error, "Impossible de déverrouiller la session par biométrie. Réessayez ou connectez-vous avec votre mot de passe.");
  }
  if (!saved) return false;
  try {
    await verifySession(saved);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await clearBio().catch(() => {});
      throw new BiometricError("Votre session biométrique a expiré ou a été révoquée. Reconnectez-vous avec votre mot de passe.");
    }
    throw error;
  }
  token = saved;
  sessionMode = "biometric";
  return true;
}

export async function saveHybridToken(value: string, biometric: boolean) {
  if (biometric) {
    requireBiometrics();
    try {
      await store.del();
      await SecureStore.setItemAsync(BIO_KEY, value, bioOptions);
    } catch (error) {
      throw biometricStorageError(error, "Impossible de protéger la session par biométrie. Réessayez ou choisissez la connexion classique.");
    }
  } else if (Platform.OS === "web") {
    await store.set(value);
  } else {
    // Un ancien coffre biométrique ne peut être détecté sans demander son déverrouillage.
    // La connexion classique mobile reste en mémoire et laisse ce coffre intact.
    try {
      await store.del();
    } catch {
      throw new Error("Impossible de préparer la connexion sur cet appareil. Réessayez.");
    }
  }
  token = value;
  sessionMode = biometric ? "biometric" : "classic";
}

export async function logout() {
  try {
    await api("/driver/auth/logout", {});
  } finally {
    await clearSession();
  }
}

export async function clearSession() {
  const mode = sessionMode;
  token = null;
  sessionMode = null;
  if (mode === "biometric") await clearBio();
  else if (mode === "classic") await store.del();
}

export async function verifySession(bearer = token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    await request("/driver/auth/session", undefined, undefined, bearer, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

// Adresse du serveur : celle compilée dans l'application, modifiable sur l'écran de connexion (utile pour un APK de test :
// on peut le pointer vers un PC du même Wi-Fi ou vers un tunnel sans recompiler).
let apiUrl = DEFAULT_API_URL;
export const getApiUrl = () => apiUrl;

let token: string | null = null;
let sessionMode: "biometric" | "classic" | null = null;
// SecureStore n'existe pas sur le web (démo/dev) : repli sur sessionStorage.
const store = {
  get: async () => (Platform.OS === "web" ? globalThis.sessionStorage?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY)),
  set: async (v: string) => (Platform.OS === "web" ? globalThis.sessionStorage?.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v)),
  del: async () => (Platform.OS === "web" ? globalThis.sessionStorage?.removeItem(KEY) : SecureStore.deleteItemAsync(KEY)),
};
export async function loadApiUrl() {
  if(TEST_APP)return DEFAULT_API_URL;
  const saved = Platform.OS === "web" ? globalThis.localStorage?.getItem(URL_KEY) ?? null : await SecureStore.getItemAsync(URL_KEY);
  const ok = saved ? normalizeApiUrl(saved) : null;
  if (ok) apiUrl = ok;
  return apiUrl;
}
export async function saveApiUrl(raw: string) {
  const u = normalizeApiUrl(raw);
  if(TEST_APP && u!==DEFAULT_API_URL)throw new Error('CliCab TEST est réservé à api-test.clicab.fr');
  if (!u) throw new Error("Adresse invalide : elle doit ressembler à http://192.168.1.20:3000 ou https://api.exemple.fr");
  if (u !== apiUrl) {
    await clearSession();
    await store.del();
    await clearBio();
    await saveDevice(null);
  }
  apiUrl = u;
  if (Platform.OS === "web") globalThis.localStorage?.setItem(URL_KEY, u); else await SecureStore.setItemAsync(URL_KEY, u);
  return u;
}
export async function loadToken() {
  token = await store.get();
  sessionMode = token ? "classic" : null;
  return token;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Échec réseau (serveur éteint, mauvaise adresse, pare-feu, CORS) : on dit quelle adresse a été tentée, pour que l'on puisse diagnostiquer. */
export const unreachableMessage = () => `Serveur injoignable (${apiUrl}). Vérifiez que l'API tourne et que l'adresse est la bonne.`;

export async function api<T = any>(path: string, body?: unknown, method?: "DELETE"): Promise<T> {
  return request<T>(path, body, method, token);
}

async function request<T>(path: string, body: unknown, method: "DELETE" | undefined, bearer: string | null, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl + path, {
      signal,
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(unreachableMessage(), 0, "NETWORK");
  }
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (error) { if (res.ok) throw error; }
  }
  if (!res.ok) {
    const passwordErrors = path === "/driver/auth/activate" ? json?.errors?.fieldErrors?.password : null;
    const message = Array.isArray(passwordErrors) && passwordErrors.length ? passwordErrors.join(" ; ") : json?.message ?? `Erreur ${res.status}`;
    throw new ApiError(message, res.status, json?.code);
  }
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
