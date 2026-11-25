import { Body, Controller, HttpException, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ErrorReporter } from "./errors";
import { SlidingLimiter } from "./hardening";
import { parse } from "./http";
import { PrismaService } from "./prisma";
import { DriverGuard } from "./security";

const Schema = z.object({
  label: z.string().max(60).optional(), message: z.string().min(1).max(500), stack: z.string().max(2000).optional(),
  platform: z.string().max(20).optional(), appVersion: z.string().max(20).optional(), fatal: z.boolean().optional(),
});

/** Les plantages de l'application chauffeur remontent ici : sans cela, un écran blanc sur un téléphone reste invisible. */
@Controller("driver/client-error")
@UseGuards(DriverGuard)
export class ClientErrorController {
  private limiter = new SlidingLimiter();
  constructor(@Inject(PrismaService) private prisma: PrismaService, @Inject(ErrorReporter) private reporter: ErrorReporter) {}
  @Post()
  async report(@Req() req: any, @Body() body: unknown) {
    if (!this.limiter.allow(req.driverId, Number(process.env.CLIENT_ERRORS_PER_HOUR) || 20, 3_600_000)) throw new HttpException("Trop de rapports d'erreur", 429);
    const e = parse(Schema, body);
    await this.prisma.auditLog.create({ data: { actor: `driver:${req.driverId}`, action: e.fatal ? "client.crash" : "client.error", entity: "ClientError", entityId: req.driverId, data: e as any } });
    await this.reporter.report({ source: `app${e.label ? `/${e.label}` : ""}`, message: e.message, stack: e.stack, context: { plateforme: e.platform, version: e.appVersion, chauffeur: String(req.driverId).slice(0, 8) } });
    return { ok: true };
  }
}
