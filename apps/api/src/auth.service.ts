import { HttpException, Inject, Injectable } from "@nestjs/common";
import { AdminRole, AdminUser } from "@prisma/client";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { PrismaService } from "./prisma";
import { config, signToken } from "./security";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const SESSION_HOURS = 8;
const throttlePerMin = () => Number(process.env.LOGIN_IP_PER_MIN) || 20;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const publicUser = (u: AdminUser) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt });

@Injectable()
export class AuthService {
  private attempts = new Map<string, number[]>();
  private dummyHash: Promise<string> | null = null;
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async audit(actor: string, action: string, entity: string, entityId: string, data?: object) {
    await this.prisma.auditLog.create({ data: { actor, action, entity, entityId, data: data as any } });
  }

  /** Limite par adresse IP (en mémoire, par instance) : complète le verrouillage par compte. */
  private throttle(key: string, now = Date.now()) {
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= throttlePerMin()) throw new HttpException("Trop de tentatives, réessayez dans une minute", 429);
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) this.attempts.clear();
  }

  async login(emailRaw: string, password: string, ip: string, now = new Date()) {
    this.throttle(ip, now.getTime());
    const email = normalizeEmail(emailRaw);
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!user || !user.active) {
      // Même durée de calcul qu'un vrai compte : ne révèle pas l'existence de l'adresse.
      this.dummyHash ??= hashPassword("dummy-password-for-timing");
      await verifyPassword(password, await this.dummyHash);
      await this.audit(`anon:${ip}`, "login.failed", "AdminUser", email, { reason: "unknown_or_inactive" });
      throw new HttpException("Identifiants invalides", 401);
    }
    if (user.lockedUntil && user.lockedUntil > now) throw new HttpException("Compte temporairement verrouillé, réessayez plus tard", 429);

    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null },
      });
      await this.audit(`anon:${ip}`, lock ? "login.locked" : "login.failed", "AdminUser", user.id);
      throw new HttpException("Identifiants invalides", 401);
    }
    await this.prisma.adminUser.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } });
    await this.audit(`admin:${user.email}`, "login.ok", "AdminUser", user.id);
    const token = signToken({ sub: user.id, role: "admin", tv: user.tokenVersion }, config.tokenSecret, SESSION_HOURS * 3600);
    return { token, user: publicUser(user) };
  }

  async createUser(actor: string, input: { email: string; name: string; role: AdminRole; password: string }) {
    const email = normalizeEmail(input.email);
    const problem = passwordProblem(input.password, email);
    if (problem) throw new HttpException({ errors: { password: [problem] } }, 422);
    if (await this.prisma.adminUser.findUnique({ where: { email } })) throw new HttpException("Un compte existe déjà avec cet e-mail", 409);
    const u = await this.prisma.adminUser.create({ data: { email, name: input.name, role: input.role, passwordHash: await hashPassword(input.password) } });
    await this.audit(actor, "user.created", "AdminUser", u.id, { email, role: u.role });
    return publicUser(u);
  }

  /** Change un mot de passe et invalide toutes les sessions de ce compte. */
  async setPassword(actor: string, userId: string, password: string) {
    const u = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!u) throw new HttpException("Compte introuvable", 404);
    const problem = passwordProblem(password, u.email);
    if (problem) throw new HttpException({ errors: { password: [problem] } }, 422);
    await this.prisma.adminUser.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } });
    await this.audit(actor, "user.password_changed", "AdminUser", userId);
  }

  async changeOwnPassword(user: { id: string; email: string }, current: string, next: string) {
    const u = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(current, u.passwordHash))) throw new HttpException("Mot de passe actuel incorrect", 403);
    await this.setPassword(`admin:${user.email}`, user.id, next);
  }

  async setActive(actor: string, userId: string, active: boolean) {
    const u = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!u) throw new HttpException("Compte introuvable", 404);
    if (!active && u.role === "ADMIN") {
      const others = await this.prisma.adminUser.count({ where: { role: "ADMIN", active: true, id: { not: userId } } });
      if (others === 0) throw new HttpException("Impossible de désactiver le dernier administrateur", 409);
    }
    await this.prisma.adminUser.update({ where: { id: userId }, data: { active, ...(active ? {} : { tokenVersion: { increment: 1 } }) } });
    await this.audit(actor, active ? "user.activated" : "user.deactivated", "AdminUser", userId);
  }
}
