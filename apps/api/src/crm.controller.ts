import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma";
import { AdminGuard, AdminOnly } from "./security";
import { parse } from "./http";
import { accountSchema, interactionSchema, listSchema, activitySchema, completeFollowUpSchema } from "./crm.schemas";

const partnerSelect = { id: true, name: true, active: true, _count: { select: { bookings: true } } } as const;
@Controller("admin/crm")
@UseGuards(AdminGuard)
@AdminOnly()
export class CrmController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  @Get()
  async list(@Query() raw: unknown) {
    const q = parse(listSchema, raw);
    const due: Prisma.CrmAccountWhereInput = { stage: { not: "LOST" }, nextActionAt: { lte: new Date() } };
    const where: Prisma.CrmAccountWhereInput = {
      AND: [
        q.stage ? { stage: q.stage } : {},
        q.overdue === "1" ? due : {},
        q.q ? { OR: ["name", "contactName", "email", "phone"].map(field => ({ [field]: { contains: q.q, mode: "insensitive" } })) as Prisma.CrmAccountWhereInput[] } : {},
      ],
    };
    const [items, total, pipeline, overdue] = await Promise.all([
      this.prisma.crmAccount.findMany({ where, include: { partner: { select: partnerSelect } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * 50, take: 50 }),
      this.prisma.crmAccount.count({ where }),
      this.prisma.crmAccount.groupBy({ by: ["stage"], _count: { _all: true } }),
      this.prisma.crmAccount.count({ where: due }),
    ]);
    return { items, total, pipeline: pipeline.map(p => ({ stage: p.stage, count: p._count._all })), overdue };
  }

  @Get("partners")
  partners() {
    return this.prisma.partner.findMany({ select: { id: true, name: true, active: true }, orderBy: { name: "asc" } });
  }

  /** Même périmètre de production que le relevé partenaire, sans données voyageurs. */
  @Get(":id/activity")
  async activity(@Param("id") id: string, @Query() raw: unknown) {
    const { days } = parse(activitySchema, raw);
    const account = await this.prisma.crmAccount.findUnique({ where: { id }, select: { partnerId: true } });
    if (!account) throw new HttpException("Fiche CRM introuvable", 404);
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 86400_000);
    const period = { from: from.toISOString(), to: to.toISOString(), days: Number(days) };
    if (!account.partnerId) return { linked: false as const, period };
    const real: Prisma.RideWhereInput = {
      booking: { partnerId: account.partnerId },
      events: { some: { type: "booking.confirmed", payload: { path: ["sandbox"], equals: false } } },
    };
    const [completed, cancelled] = await Promise.all([
      this.prisma.ride.aggregate({ where: { ...real, status: "COMPLETED", pickupAt: { gte: from, lt: to } }, _count: { _all: true }, _sum: { priceCents: true, driverNetCents: true } }),
      this.prisma.ride.aggregate({ where: { ...real, status: { in: ["CANCELLED_BY_PARTNER", "CANCELLED_BY_CLIENT"] }, cancelledAt: { gte: from, lt: to } }, _count: { _all: true }, _sum: { cancellationFeeCents: true, driverCompensationCents: true } }),
    ]);
    const completedCents = completed._sum.priceCents ?? 0;
    const cancellationCents = cancelled._sum.cancellationFeeCents ?? 0;
    const driverCents = (completed._sum.driverNetCents ?? 0) + (cancelled._sum.driverCompensationCents ?? 0);
    const grossCents = completedCents + cancellationCents;
    return { linked: true as const, period, completed: completed._count._all, cancelled: cancelled._count._all, completedCents, cancellationCents, grossCents, driverCents, spreadCents: grossCents - driverCents };
  }

  @Post(":id/follow-up/complete")
  async completeFollowUp(@Req() req: any, @Param("id") id: string, @Body() raw: unknown) {
    const { action, at } = parse(completeFollowUpSchema, raw);
    return this.prisma.$transaction(async tx => {
      const changed = await tx.crmAccount.updateMany({
        where: { id, nextAction: action, nextActionAt: at },
        data: { nextAction: null, nextActionAt: null },
      });
      if (changed.count !== 1) throw new HttpException("La relance a changé ou a déjà été traitée. Actualisez la fiche.", 409);
      await tx.crmInteraction.create({ data: { accountId: id, kind: "NOTE", note: "Relance effectuée : " + action, actor: req.admin.actor } });
      await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.follow_up_completed", entity: "CrmAccount", entityId: id } });
      return { ok: true };
    });
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    const account = await this.prisma.crmAccount.findUnique({ where: { id }, include: {
      partner: { select: partnerSelect },
      interactions: { orderBy: { createdAt: "desc" }, take: 100 },
    } });
    if (!account) throw new HttpException("Fiche CRM introuvable", 404);
    return account;
  }

  @Post()
  async create(@Req() req: any, @Body() raw: unknown) {
    const input = parse(accountSchema, raw);
    try {
      return await this.prisma.$transaction(async tx => {
        const row = await tx.crmAccount.create({ data: input });
        await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.created", entity: "CrmAccount", entityId: row.id } });
        return row;
      });
    } catch (e) { this.mapError(e); }
  }

  @Post(":id")
  async update(@Req() req: any, @Param("id") id: string, @Body() raw: unknown) {
    const input = parse(accountSchema, raw);
    try {
      return await this.prisma.$transaction(async tx => {
        const old = await tx.crmAccount.findUniqueOrThrow({ where: { id } });
        const row = await tx.crmAccount.update({ where: { id }, data: input });
        await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.updated", entity: "CrmAccount", entityId: id, data: { fromStage: old.stage, toStage: row.stage } } });
        return row;
      });
    } catch (e) { this.mapError(e); }
  }

  @Post(":id/interactions")
  async interaction(@Req() req: any, @Param("id") id: string, @Body() raw: unknown) {
    const input = parse(interactionSchema, raw);
    try {
      return await this.prisma.$transaction(async tx => {
        const row = await tx.crmInteraction.create({ data: { ...input, accountId: id, actor: req.admin.actor } });
        await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.interaction", entity: "CrmAccount", entityId: id } });
        return row;
      });
    } catch (e) { this.mapError(e); }
  }

  // Supprime uniquement la fiche commerciale et ses notes, jamais le partenaire ni ses réservations.
  @Post(":id/delete")
  async remove(@Req() req: any, @Param("id") id: string) {
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.crmAccount.delete({ where: { id } });
        await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.deleted", entity: "CrmAccount", entityId: id } });
        return { ok: true };
      });
    } catch (e) { this.mapError(e); }
  }

  private mapError(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") throw new HttpException("Ce partenaire est déjà associé à une fiche CRM", 409);
      if (e.code === "P2025" || e.code === "P2003") throw new HttpException("Fiche ou partenaire introuvable", 404);
    }
    throw e;
  }
}
