import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "./prisma";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function generateApiKey(sandbox: boolean) {
  const key = `vtc_${sandbox ? "test" : "live"}_${randomBytes(24).toString("hex")}`;
  return { key, prefix: key.slice(0, 14), hash: sha256(key) };
}

export function generateCompanyKey() {
  const key = `cmp_${randomBytes(24).toString("hex")}`;
  return { key, prefix: key.slice(0, 12), hash: sha256(key) };
}

/** Signature de webhook : HMAC-SHA256 de `${timestamp}.${body}`. */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signToken(payload: Record<string, unknown>, secret: string, ttlSec: number): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): Record<string, any> | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
}

export const config = {
  get adminToken() { return process.env.ADMIN_TOKEN ?? ""; },
  get tokenSecret() { return process.env.TOKEN_SECRET ?? "dev-secret-change-me"; },
};

function bearer(req: any): string | undefined {
  const h: string | undefined = req.headers["authorization"];
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

@Injectable()
export class PartnerGuard implements CanActivate {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const key = bearer(req);
    if (!key) throw new HttpException("Clé API manquante", 401);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: sha256(key) },
      include: { partner: true },
    });
    if (!apiKey || apiKey.revokedAt || !apiKey.partner.active) throw new HttpException("Clé API invalide", 401);
    req.partner = apiKey.partner;
    req.sandbox = apiKey.sandbox;
    return true;
  }
}

@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const key = bearer(req);
    if (!key) throw new HttpException("Clé société manquante", 401);
    const company = await this.prisma.company.findUnique({ where: { accessKeyHash: sha256(key) } });
    if (!company || !company.active) throw new HttpException("Clé société invalide", 401);
    req.company = company;
    return true;
  }
}

export const ROLES_KEY = "admin_roles";
/** Réserve une route (ou un contrôleur) aux administrateurs ; sans cette marque, un régulateur y a accès. */
export const AdminOnly = () => SetMetadata(ROLES_KEY, ["ADMIN"]);

export interface AdminIdentity { id: string | null; email: string; role: "ADMIN" | "DISPATCHER"; actor: string }

/**
 * Accepte soit une session de compte nominatif (`Authorization: Bearer`), soit le token de service `x-admin-token`
 * (scripts, simulateur). Le token de service est refusé si ADMIN_TOKEN n'est pas défini.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(PrismaService) private prisma: PrismaService, @Inject(Reflector) private reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    const legacy = req.headers["x-admin-token"];
    if (typeof legacy === "string") {
      if (!config.adminToken || !safeEqual(legacy, config.adminToken)) throw new HttpException("Accès refusé", 401);
      req.admin = { id: null, email: "service", role: "ADMIN", actor: "service" } satisfies AdminIdentity;
      return true;
    }
    const token = bearer(req);
    const payload = token ? verifyToken(token, config.tokenSecret) : null;
    if (!payload || payload.role !== "admin") throw new HttpException("Non authentifié", 401);
    const user = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    // tokenVersion : un changement de mot de passe ou une désactivation coupe immédiatement les sessions ouvertes.
    if (!user || !user.active || user.tokenVersion !== payload.tv) throw new HttpException("Session expirée", 401);
    if (required && !required.includes(user.role)) throw new HttpException("Droits insuffisants", 403);
    req.admin = { id: user.id, email: user.email, role: user.role, actor: `admin:${user.email}` } satisfies AdminIdentity;
    return true;
  }
}

@Injectable()
export class DriverGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const token = bearer(req);
    const payload = token ? verifyToken(token, config.tokenSecret) : null;
    if (!payload || payload.role !== "driver") throw new HttpException("Non authentifié", 401);
    req.driverId = payload.sub;
    return true;
  }
}
