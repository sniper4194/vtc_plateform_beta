import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { parse } from "./http";
import { PrismaService } from "./prisma";
import { AdminGuard } from "./security";

const LoginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const PasswordSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private auth: AuthService,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}

  @Post("login")
  login(@Req() req: any, @Body() body: unknown) {
    const b = parse(LoginSchema, body);
    return this.auth.login(b.email, b.password, req.ip ?? "unknown");
  }

  @Get("me")
  @UseGuards(AdminGuard)
  me(@Req() req: any) {
    return { email: req.admin.email, role: req.admin.role, service: req.admin.id === null };
  }

  @Post("password")
  @UseGuards(AdminGuard)
  async password(@Req() req: any, @Body() body: unknown) {
    const b = parse(PasswordSchema, body);
    if (!req.admin.id) return { error: "Le token de service n'a pas de mot de passe" };
    await this.auth.changeOwnPassword({ id: req.admin.id, email: req.admin.email }, b.current, b.next);
    return { ok: true };
  }
}
