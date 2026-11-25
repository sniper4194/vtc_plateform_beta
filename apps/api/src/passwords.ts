import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

/** Hache un mot de passe : `scrypt:N:r:p:sel:empreinte` (paramètres inclus pour pouvoir les durcir plus tard). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join(":");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split(":");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const MIN_PASSWORD_LENGTH = 12;

/** Règle minimale : 12 caractères, différent de l'e-mail. Retourne un message d'erreur ou null. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) return "Le mot de passe ne doit pas contenir votre identifiant";
  return null;
}
