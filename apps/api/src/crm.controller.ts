import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma";
import { AdminGuard, AdminOnly } from "./security";
import { parse } from "./http";
import { accountSchema, interactionSchema, listSchema } from "./crm.schemas";

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
