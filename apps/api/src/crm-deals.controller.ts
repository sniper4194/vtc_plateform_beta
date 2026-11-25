import { Body, Controller, Get, HttpException, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma";
import { AdminGuard, AdminOnly, generateApiKey } from "./security";
import { parse } from "./http";
import { dealSchema, dealActionSchema, signatureSchema, todayParis, totals, nextStatus } from "./crm-deals";

@Controller("admin/crm")
@UseGuards(AdminGuard)
@AdminOnly()
export class CrmDealsController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  @Get("renewals")
  async renewals() {
    const today = todayParis();
    const until = new Date(today.getTime() + 60 * 86400_000);
    return this.prisma.crmDeal.findMany({
      where: { status: "SIGNED", renewalOn: { lte: until }, endsOn: { gte: today } },
      select: { id: true, ref: true, contractRef: true, renewalOn: true, endsOn: true, account: { select: { id: true, name: true } } },
      orderBy: [{ renewalOn: "asc" }, { id: "asc" }], take: 200,
    });
  }

  @Get(":accountId/deals")
  async list(@Param("accountId") accountId: string) {
    if (!await this.prisma.crmAccount.findUnique({ where: { id: accountId }, select: { id: true } })) throw new HttpException("Fiche introuvable", 404);
    const rows = await this.prisma.crmDeal.findMany({ where: { accountId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 200 });
    return rows.map(d => ({ ...d, ...totals(d.quantity, d.unitCents, d.vatBps) }));
  }

  @Post(":accountId/deals")
  async create(@Req() req: any, @Param("accountId") accountId: string, @Body() raw: unknown) {
    const { multiplierBps, ...data } = parse(dealSchema, raw);
    if (data.validUntil < todayParis()) throw new HttpException("Date de validité passée", 422);
    return this.prisma.$transaction(async tx => {
      const a = await tx.crmAccount.findUnique({ where: { id: accountId } });
      if (!a) throw new HttpException("Fiche introuvable", 404);
      const d = await tx.crmDeal.create({ data: { ...data, accountId, recipientName: a.name, priceMultiplier: new Prisma.Decimal(multiplierBps).div(10000) } });
      await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.deal_created", entity: "CrmDeal", entityId: d.id } });
      return { ...d, ...totals(d.quantity, d.unitCents, d.vatBps) };
    });
  }

  @Post(":accountId/deals/:id/action")
  async action(@Req() req: any, @Param("accountId") accountId: string, @Param("id") id: string, @Body() raw: unknown) {
    const { action } = parse(dealActionSchema, raw);
    return this.prisma.$transaction(async tx => {
      const d = await tx.crmDeal.findFirst({ where: { id, accountId } });
      if (!d) throw new HttpException("Devis introuvable", 404);
      const status = nextStatus(d.status, action, d.validUntil >= todayParis());
      if (!status) throw new HttpException("Transition impossible ou devis expiré", 409);
      const updated = await tx.crmDeal.updateMany({ where: { id, status: d.status }, data: { status, ...(status === "SENT" ? { sentAt: new Date() } : status === "ACCEPTED" ? { acceptedAt: new Date() } : {}) } });
      if (!updated.count) throw new HttpException("Devis modifié simultanément", 409);
      if (status === "SENT") await tx.crmAccount.updateMany({ where: { id: accountId, stage: { in: ["PROSPECT","CONTACTED"] } }, data: { stage: "OFFER" } });
      if (status === "ACCEPTED") await tx.crmAccount.updateMany({ where: { id: accountId, stage: { in: ["PROSPECT","CONTACTED","OFFER"] } }, data: { stage: "NEGOTIATION" } });
      await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.deal_" + status.toLowerCase(), entity: "CrmDeal", entityId: id } });
      return { ok: true };
    });
  }

  @Post(":accountId/deals/:id/sign")
  async sign(@Req() req: any, @Param("accountId") accountId: string, @Param("id") id: string, @Body() raw: unknown) {
    const data = parse(signatureSchema, raw);
    if (data.endsOn < todayParis()) throw new HttpException("Contrat déjà échu", 422);
    return this.prisma.$transaction(async tx => {
      const change = await tx.crmDeal.updateMany({ where: { id, accountId, status: "ACCEPTED" }, data: { ...data, status: "SIGNED", signedAt: new Date() } });
      if (!change.count) throw new HttpException("Devis non accepté ou déjà signé", 409);
      await tx.crmAccount.update({ where: { id: accountId }, data: { stage: "WON" } });
      await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.contract_recorded", entity: "CrmDeal", entityId: id } });
      return { ok: true };
    });
  }

  // Provisionnement explicite en sandbox seulement. Ne touche jamais au tarif d'un partenaire existant.
  @Post(":accountId/deals/:id/provision")
  async provision(@Req() req: any, @Param("accountId") accountId: string, @Param("id") id: string) {
    return this.prisma.$transaction(async tx => {
      const today = todayParis();
      const d = await tx.crmDeal.findFirst({ where: { id, accountId, status: "SIGNED", startsOn: { lte: today }, endsOn: { gte: today } }, include: { account: true } });
      if (!d || d.account.partnerId || d.account.stage !== "WON") throw new HttpException("Contrat actif et fiche gagnée sans partenaire requis", 409);
      const p = await tx.partner.create({ data: { name: d.account.name, priceMultiplier: d.priceMultiplier } });
      const changed = await tx.crmAccount.updateMany({ where: { id: accountId, partnerId: null, stage: "WON" }, data: { partnerId: p.id } });
      if (!changed.count) throw new HttpException("Partenaire déjà associé", 409);
      const k = generateApiKey(true);
      await tx.apiKey.create({ data: { partnerId: p.id, keyHash: k.hash, prefix: k.prefix, sandbox: true } });
      await tx.auditLog.create({ data: { actor: req.admin.actor, action: "crm.partner_sandbox_created", entity: "CrmAccount", entityId: accountId, data: { partnerId: p.id, dealId: id } } });
      return { partnerId: p.id, apiKey: k.key };
    });
  }
}
