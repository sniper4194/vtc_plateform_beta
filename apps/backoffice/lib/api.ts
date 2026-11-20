export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const ADMIN = "vtc_admin_token";
const USER = "vtc_admin_user";
const COMPANY = "vtc_company_key";
const read = (k: string) => (typeof window === "undefined" ? "" : sessionStorage.getItem(k) ?? "");

export const getToken = () => read(ADMIN);
export const setToken = (t: string) => sessionStorage.setItem(ADMIN, t);
export const clearToken = () => { sessionStorage.removeItem(ADMIN); sessionStorage.removeItem(USER); };
export interface AdminSession { email: string; name: string; role: "ADMIN" | "DISPATCHER" }
export const getUser = (): AdminSession | null => { try { return JSON.parse(read(USER) || "null"); } catch { return null; } };
export const setUser = (u: AdminSession) => sessionStorage.setItem(USER, JSON.stringify(u));
export const getCompanyKey = () => read(COMPANY);
export const setCompanyKey = (t: string) => sessionStorage.setItem(COMPANY, t);
export const clearCompanyKey = () => sessionStorage.removeItem(COMPANY);

async function request<T>(path: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(json?.message ?? `Erreur ${res.status}`), { status: res.status, body: json });
  return json as T;
}

/** Connexion d'un compte du back-office. */
export const login = (email: string, password: string) => request<{ token: string; user: AdminSession }>("/auth/login", {}, { email, password });

/** Appel authentifié en administrateur. */
export const api = <T = any>(path: string, body?: unknown) =>
  request<T>(path, { authorization: `Bearer ${getToken()}` }, body).catch((e) => {
    // Session expirée ou révoquée : retour à l'écran de connexion.
    if (e?.status === 401 && typeof window !== "undefined") { clearToken(); window.dispatchEvent(new Event("vtc-auth-expired")); }
    throw e;
  });
/** Appel authentifié avec la clé d'une société partenaire. */
export const capi = <T = any>(path: string, body?: unknown) => request<T>(path, { authorization: `Bearer ${getCompanyKey()}` }, body);

/** Télécharge un fichier protégé (en-tête d'autorisation) puis le propose à l'enregistrement. */
export async function downloadCompanyFile(path: string, filename: string) {
  const res = await fetch(API_URL + path, { headers: { authorization: `Bearer ${getCompanyKey()}` } });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const eur = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
export const dt = (s: string) => new Date(s).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const day = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
