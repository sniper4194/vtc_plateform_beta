import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SlidingLimiter } from "./hardening";
import { parse } from "./http";
import { LEVELS } from "./recruitment";
import { RecruitmentService } from "./recruitment.service";
import { phoneField } from "./schemas";
import { AdminGuard, AdminOnly, DriverGuard } from "./security";

const ApplySchema = z.object({
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80),
  phone: phoneField, email: z.string().trim().email().max(200),
  yearsExperience: z.number().int().min(0).max(60),
  otherPlatforms: z.array(z.object({ name: z.string().trim().min(1).max(60), rating: z.number().min(0).max(5).optional() })).max(6).optional(),
  referralCode: z.string().trim().min(6).max(30),
  consent: z.literal(true, { errorMap: () => ({ message: "Le consentement est nécessaire pour traiter votre candidature" }) }),
});

/** Dépôt de candidature : public, donc limité par adresse IP (5 par heure) et sans aucune information sur les codes existants. */
@Controller("apply")
export class ApplyController {
  constructor(@Inject(RecruitmentService) private svc: RecruitmentService) {}
  private limiter = new SlidingLimiter();
  @Post()
  apply(@Req() req: any, @Body() body: unknown) {
    const max = Number(process.env.APPLY_IP_PER_HOUR) || 5;
    if (!this.limiter.allow(req.ip ?? "?", max, 3_600_000)) throw new HttpException("Trop de tentatives, réessayez plus tard", 429);
    return this.svc.apply(parse(ApplySchema, body));
  }
}

const ChecksSchema = z.object({
  cardProValidUntil: z.coerce.date().optional(),
  licencePoints: z.number().int().min(0).max(12).optional(),
  licenceNoSuspension: z.boolean().optional(),
  honorStatement: z.boolean().optional(),
});
const TestsSchema = z.object({
  frenchScore: z.number().int().min(0).max(100).optional(), englishLevel: z.enum(LEVELS).optional(), ethicsScore: z.number().int().min(0).max(100).optional(),
}).refine((v) => Object.keys(v).length > 0, "Aucun résultat fourni");

@Controller("admin/applications")
@UseGuards(AdminGuard)
@AdminOnly() // données personnelles : réservé aux administrateurs
export class AdminRecruitmentController {
  constructor(@Inject(RecruitmentService) private svc: RecruitmentService) {}
  @Get() list(@Query("status") status?: string) { return this.svc.list(status); }
  @Get("codes") codes() { return this.svc.adminCodes(); }
  @Get("tree") tree() { return this.svc.tree(); }
  @Post("codes") founder(@Req() req: any, @Body() body: unknown) {
    const b = parse(z.object({ label: z.string().trim().min(2).max(80), count: z.number().int().min(1).max(50).default(1), maxUses: z.number().int().min(1).max(20).default(1) }), body);
    return this.svc.createFounderCodes(req.admin.actor, b.label, b.count, b.maxUses);
  }
  @Post("codes/:id/revoke") revoke(@Req() req: any, @Param("id") id: string) { return this.svc.revokeCode(id, req.admin.actor); }
  @Get(":id") get(@Param("id") id: string) { return this.svc.get(id); }
  @Post(":id/checks") checks(@Req() req: any, @Param("id") id: string, @Body() body: unknown) { return this.svc.setChecks(id, req.admin.actor, parse(ChecksSchema, body)); }
  @Post(":id/tests") tests(@Req() req: any, @Param("id") id: string, @Body() body: unknown) { return this.svc.setTests(id, req.admin.actor, parse(TestsSchema, body)); }
  @Post(":id/interview") interview(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.setInterview(id, req.admin.actor, parse(z.object({ notes: z.string().trim().min(3).max(2000) }), body).notes);
  }
  @Post(":id/accept") accept(@Req() req: any, @Param("id") id: string) { return this.svc.accept(id, req.admin.actor); }
  @Post(":id/reject") reject(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.reject(id, req.admin.actor, parse(z.object({ reason: z.string().trim().min(5).max(500) }), body).reason);
  }
  @Post(":id/anonymize") anonymize(@Req() req: any, @Param("id") id: string) { return this.svc.anonymize(id, req.admin.actor).then(() => ({ ok: true })); }
}

@Controller("driver/referral")
@UseGuards(DriverGuard)
export class DriverReferralController {
  constructor(@Inject(RecruitmentService) private svc: RecruitmentService) {}
  @Get() mine(@Req() req: any) { return this.svc.driverCodes(req.driverId); }
  @Post() create(@Req() req: any) { return this.svc.createDriverCode(req.driverId); }
}
