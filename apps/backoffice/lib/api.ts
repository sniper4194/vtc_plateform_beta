export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const KEY = "vtc_admin_token";
export const getToken = () => (typeof window === "undefined" ? "" : sessionStorage.getItem(KEY) ?? "");
export const setToken = (t: string) => sessionStorage.setItem(KEY, t);
export const clearToken = () => sessionStorage.removeItem(KEY);

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-admin-token": getToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(json?.message ?? `Erreur ${res.status}`), { status: res.status, body: json });
  return json as T;
}

export const eur = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
export const dt = (s: string) =>
  new Date(s).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
