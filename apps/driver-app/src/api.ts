import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { normalizeApiUrl } from "./format";

const TEST_APP = process.env.EXPO_PUBLIC_CLICAB_TEST === "1";
const DEFAULT_API_URL = TEST_APP ? "https://api-test.clicab.fr" : process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const KEY = "driver_token";
const URL_KEY = "api_url";
const DEVICE_KEY="driver_device_v1", BIO_KEY="driver_bio_v1";
const bioOptions={requireAuthentication:true,keychainService:"clicab_biometric",authenticationPrompt:"Déverrouiller votre session CliCab"};
export const biometricAvailable=()=>Platform.OS!=="web"&&SecureStore.canUseBiometricAuthentication();
export async function loadDevice(){return Platform.OS==="web"?null:SecureStore.getItemAsync(DEVICE_KEY);}
export async function saveDevice(v:string|null){if(Platform.OS==="web")return;if(v)await SecureStore.setItemAsync(DEVICE_KEY,v);else await SecureStore.deleteItemAsync(DEVICE_KEY);}
async function clearBio(){if(Platform.OS!=="web")await SecureStore.deleteItemAsync(BIO_KEY,bioOptions);}
export async function unlockBiometric(){if(!biometricAvailable())return false;const v=await SecureStore.getItemAsync(BIO_KEY,bioOptions);if(!v)return false;token=v;try{await api("/driver/auth/session");return true;}catch(e){token=null;if(e instanceof ApiError&&e.status===401)await clearBio();throw e;}}
export async function saveHybridToken(t:string,biometric:boolean){await saveToken(null);if(biometric&&biometricAvailable()){await SecureStore.setItemAsync(BIO_KEY,t,bioOptions);token=t;}else await saveToken(t);}
export async function logout(){try{await api("/driver/auth/logout",{});}finally{await saveToken(null);}}

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
  if(u!==apiUrl){await saveToken(null);await saveDevice(null);}
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
  if (t) {await clearBio();await store.set(t);}
  else {await store.del();await clearBio();}
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Échec réseau (serveur éteint, mauvaise adresse, pare-feu, CORS) : on dit quelle adresse a été tentée, pour que l'on puisse diagnostiquer. */
export const unreachableMessage = () => `Serveur injoignable (${apiUrl}). Vérifiez que l'API tourne et que l'adresse est la bonne.`;

export async function api<T = any>(path: string, body?: unknown, method?: "DELETE"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(unreachableMessage(), 0, "NETWORK");
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
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
