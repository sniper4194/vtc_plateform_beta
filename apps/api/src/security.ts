import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from "@nestjs/common";
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

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const given = req.headers["x-admin-token"];
    // Refuse si ADMIN_TOKEN n'est pas configuré : pas d'accès par défaut.
    if (!config.adminToken || typeof given !== "string" || !safeEqual(given, config.adminToken)) {
      throw new HttpException("Accès refusé", 401);
    }
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
