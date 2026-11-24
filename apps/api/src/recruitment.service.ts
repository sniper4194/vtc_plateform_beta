import { referralRewardConfig } from "./referral-rewards";
import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma";
import { EmailService } from "./email";
import { newReferralCode, normalizeCode, readiness, thresholds } from "./recruitment";

const ACTIVE_USES = ["SUBMITTED", "IN_REVIEW", "ACCEPTED"] as const;

export interface ApplyInput {
  firstName: string; lastName: string; phone: string; email: string; yearsExperience: number;
  otherPlatforms?: { name: string; rating?: number }[]; referralCode: string; consent: true;
}

@Injectable()
export class RecruitmentService {
  private log = new Logger("recruitment");
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(EmailService) private email: EmailService,
  ) {}

  private async audit(actor: string, action: string, id: string, data?: object) {
    await this.prisma.auditLog.create({ data: { actor, action, entity: "Application", entityId: id, data: data as any } });
  }

  private async mail(to: string, subject: string, text: string) {
    try { await this.email.provider?.send({ to, subject, text }); } catch (e: any) { this.log.warn(`e-mail non envoyé : ${e?.message ?? e}`); }
  }

  /** Utilisations d'un code : les candidatures refusées ou retirées libèrent la place. */
  private async usesOf(codeId: string) {
    return this.prisma.application.count({ where: { referralCodeId: codeId, status: { in: [...ACTIVE_USES] } } });
  }

  // ---------- candidat (public) ----------
  async apply(input: ApplyInput) {
    const t = thresholds();
    const code = await this.prisma.referralCode.findUnique({ where: { code: normalizeCode(input.referralCode) } });
    // Même message dans tous les cas : on ne confirme pas quels codes existent.
    if (!code || code.revokedAt || (await this.usesOf(code.id)) >= code.maxUses) throw new HttpException("Code de parrainage invalide ou déjà utilisé", 422);

    const email = input.email.trim().toLowerCase();
    const since = new Date(Date.now() - t.retestDays * 86_400_000);
    const prior = await this.prisma.application.findMany({
      where: { OR: [{ phone: input.phone }, { email }], anonymizedAt: null }, select: { status: true, decidedAt: true },
    });
    if (prior.some((p) => p.status === "SUBMITTED" || p.status === "IN_REVIEW")) throw new HttpException("Une candidature est déjà en cours pour ce numéro ou cette adresse", 409);
    if (prior.some((p) => p.status === "ACCEPTED")) throw new HttpException("Vous êtes déjà chauffeur CliCab : connectez-vous à l'application", 409);
    if (prior.some((p) => p.status === "REJECTED" && p.decidedAt && p.decidedAt > since)) throw new HttpException(`Votre dernière candidature a été refusée il y a moins de ${t.retestDays} jours : vous pourrez en déposer une nouvelle ensuite`, 409);
    if (await this.prisma.driver.findFirst({ where: { OR: [{ phone: input.phone }, { email }] }, select: { id: true } })) throw new HttpException("Un compte chauffeur existe déjà pour ce numéro ou cette adresse", 409);

    const app = await this.prisma.application.create({
      data: {
        firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone, email, yearsExperience: input.yearsExperience,
        otherPlatforms: (input.otherPlatforms ?? []) as any, referralCodeId: code.id, consentAt: new Date(),
      },
    });
    await this.audit("candidate", "application.submitted", app.id, { codeId: code.id });
    await this.mail(email, "CliCab : votre candidature est bien reçue",
      `Bonjour ${app.firstName},\n\nNous avons bien reçu votre candidature (référence ${app.id.slice(0, 8).toUpperCase()}).\n\nVoici la suite : vérification de votre carte professionnelle et de votre permis, tests de français, d'anglais et mise en situation, puis un entretien. Nous vous répondrons dans tous les cas.\n\nL'équipe CliCab`);
    return { reference: app.id.slice(0, 8).toUpperCase(), status: app.status };
  }

  // ---------- équipe ----------
  private view(a: any) {
    const missing = readiness(a);
    return {
      id: a.id, ref: a.id.slice(0, 8).toUpperCase(), status: a.status, createdAt: a.createdAt,
      firstName: a.firstName, lastName: a.lastName, phone: a.phone, email: a.email, yearsExperience: a.yearsExperience, otherPlatforms: a.otherPlatforms ?? [],
      sponsor: a.referralCode ? { code: a.referralCode.code, founder: !a.referralCode.ownerDriverId, label: a.referralCode.label ?? null, driver: a.referralCode.owner ? { id: a.referralCode.owner.id, name: `${a.referralCode.owner.firstName} ${a.referralCode.owner.lastName}` } : null } : null,
      checks: {
        cardProValidUntil: a.cardProValidUntil, licenceCheckedAt: a.licenceCheckedAt, licenceCheckedBy: a.licenceCheckedBy, licencePointsOk: a.licencePointsOk,
        licenceNoSuspension: a.licenceNoSuspension, honorStatementAt: a.honorStatementAt,
      },
      tests: { frenchScore: a.frenchScore, englishLevel: a.englishLevel, ethicsScore: a.ethicsScore, testsBy: a.testsBy, testsAt: a.testsAt },
      interview: { notes: a.interviewNotes, at: a.interviewAt, by: a.interviewBy },
      decision: { reason: a.decisionReason, by: a.decidedBy, at: a.decidedAt },
      driverId: a.driverId, missing, ready: missing.length === 0, thresholds: thresholds(),
    };
  }

  async list(status?: string) {
    const rows = await this.prisma.application.findMany({
      where: { anonymizedAt: null, ...(status ? { status: status as any } : {}) }, include: { referralCode: { include: { owner: true } } },
      orderBy: { createdAt: "desc" }, take: 200,
    });
    return rows.map((a) => this.view(a));
  }

  async get(id: string) {
    const a = await this.prisma.application.findUnique({ where: { id }, include: { referralCode: { include: { owner: true } } } });
    if (!a) throw new HttpException("Candidature introuvable", 404);
    const history = await this.prisma.auditLog.findMany({ where: { entity: "Application", entityId: id }, orderBy: { createdAt: "asc" } });
    return { ...this.view(a), history: history.map((h) => ({ at: h.createdAt, actor: h.actor, action: h.action, data: h.data })) };
  }

  private async editable(id: string) {
    const a = await this.prisma.application.findUnique({ where: { id } });
    if (!a) throw new HttpException("Candidature introuvable", 404);
    if (a.status === "ACCEPTED" || a.status === "REJECTED" || a.status === "WITHDRAWN" || a.anonymizedAt) throw new HttpException("Cette candidature est clôturée", 409);
    return a;
  }

  async setChecks(id: string, actor: string, c: { cardProValidUntil?: Date; licencePoints?: number; licenceNoSuspension?: boolean; honorStatement?: boolean }) {
    await this.editable(id);
    const t = thresholds();
    const data: any = { status: "IN_REVIEW" };
    if (c.cardProValidUntil) data.cardProValidUntil = c.cardProValidUntil;
    // Seul le résultat est conservé : le nombre de points et le relevé lui-même ne sont pas enregistrés.
    if (c.licencePoints !== undefined || c.licenceNoSuspension !== undefined) {
      if (c.licencePoints === undefined || c.licenceNoSuspension === undefined) throw new HttpException("Indiquez le nombre de points ET l'absence de suspension", 422);
      Object.assign(data, { licenceCheckedAt: new Date(), licenceCheckedBy: actor, licencePointsOk: c.licencePoints >= t.minPoints, licenceNoSuspension: c.licenceNoSuspension });
    }
    if (c.honorStatement) data.honorStatementAt = new Date();
    await this.prisma.application.update({ where: { id }, data });
    await this.audit(actor, "application.checks", id, {
      cardProValidUntil: c.cardProValidUntil ?? undefined, licenceChecked: c.licencePoints !== undefined ? { pointsOk: c.licencePoints >= t.minPoints, noSuspension: c.licenceNoSuspension } : undefined, honorStatement: c.honorStatement || undefined,
    });
    return this.get(id);
  }

  async setTests(id: string, actor: string, tst: { frenchScore?: number; englishLevel?: string; ethicsScore?: number }) {
    await this.editable(id);
    await this.prisma.application.update({ where: { id }, data: { ...tst, testsBy: actor, testsAt: new Date(), status: "IN_REVIEW" } });
    await this.audit(actor, "application.tests", id, tst);
    return this.get(id);
  }

  async setInterview(id: string, actor: string, notes: string) {
    await this.editable(id);
    await this.prisma.application.update({ where: { id }, data: { interviewNotes: notes, interviewAt: new Date(), interviewBy: actor, status: "IN_REVIEW" } });
    await this.audit(actor, "application.interview", id);
    return this.get(id);
  }

  /** Acceptation : refusée tant qu'un critère manque (aucune dérogation) ; crée le compte chauffeur, rattaché à son parrain. */
  async accept(id: string, actor: string) {
    const a = await this.editable(id);
    const missing = readiness(a as any);
    if (missing.length) throw new HttpException({ message: "Critères non remplis", missing }, 409);
    const code = await this.prisma.referralCode.findUniqueOrThrow({ where: { id: a.referralCodeId } });
    const driver = await this.prisma.$transaction(async (tx) => {
      const d = await tx.driver.create({
        data: { firstName: a.firstName, lastName: a.lastName, phone: a.phone, email: a.email, sponsorId: code.ownerDriverId },
      });
      await tx.application.update({ where: { id }, data: { status: "ACCEPTED", decidedBy: actor, decidedAt: new Date(), decisionReason: null, driverId: d.id } });
      return d;
    }).catch((e: any) => {
      if (e?.code === "P2002") throw new HttpException("Un compte chauffeur existe déjà avec ce numéro ou cette adresse", 409);
      throw e;
    });
    await this.audit(actor, "application.accepted", id, { driverId: driver.id, sponsorDriverId: code.ownerDriverId, founderCode: !code.ownerDriverId });
    await this.mail(a.email, "CliCab : votre candidature est acceptée",
      `Bonjour ${a.firstName},\n\nBonne nouvelle : votre candidature est acceptée. Il reste à transmettre vos documents (carte professionnelle, assurance, carte grise, contrôle technique…) et votre véhicule pour finaliser votre compte. Connectez-vous à l'application chauffeur avec ce numéro de téléphone.\n\nL'équipe CliCab`);
    return { driverId: driver.id };
  }

  async reject(id: string, actor: string, reason: string) {
    const a = await this.editable(id);
    await this.prisma.application.update({ where: { id }, data: { status: "REJECTED", decidedBy: actor, decidedAt: new Date(), decisionReason: reason } });
    await this.audit(actor, "application.rejected", id, { reason });
    await this.mail(a.email, "CliCab : réponse à votre candidature",
      `Bonjour ${a.firstName},\n\nNous ne pouvons pas donner suite à votre candidature pour le moment.\nMotif : ${reason}\n\nVous pourrez en déposer une nouvelle dans ${thresholds().retestDays} jours. Pour toute question ou pour contester cette décision, répondez à ce message.\n\nL'équipe CliCab`);
    return this.get(id);
  }

  /** Droit à l'effacement et durée de conservation : les candidatures refusées ou retirées sont rendues anonymes. */
  async anonymize(id: string, actor: string) {
    const a = await this.prisma.application.findUnique({ where: { id } });
    if (!a) throw new HttpException("Candidature introuvable", 404);
    if (a.status === "ACCEPTED") throw new HttpException("Un compte chauffeur est lié à cette candidature", 409);
    await this.prisma.application.update({
      where: { id }, data: { firstName: "—", lastName: "—", phone: `anon-${a.id}`, email: `anon-${a.id}@anonyme.invalid`, otherPlatforms: [] as any, interviewNotes: null, licenceCheckedBy: null, anonymizedAt: new Date(), status: a.status === "SUBMITTED" || a.status === "IN_REVIEW" ? "WITHDRAWN" : a.status },
    });
    await this.audit(actor, "application.anonymized", id);
  }

  async sweep() {
    const cutoff = new Date(Date.now() - thresholds().retentionDays * 86_400_000);
    const old = await this.prisma.application.findMany({ where: { status: { in: ["REJECTED", "WITHDRAWN"] }, anonymizedAt: null, updatedAt: { lt: cutoff } }, select: { id: true } });
    for (const o of old) await this.anonymize(o.id, "system");
    return old.length;
  }

  // ---------- codes de parrainage ----------
  private codeView(c: any, uses: number) {
    return { id: c.id, code: c.code, label: c.label, founder: !c.ownerDriverId, maxUses: c.maxUses, uses, revoked: !!c.revokedAt, createdAt: c.createdAt, owner: c.owner ? `${c.owner.firstName} ${c.owner.lastName}` : null };
  }

  async adminCodes() {
    const rows = await this.prisma.referralCode.findMany({ include: { owner: true }, orderBy: { createdAt: "desc" }, take: 300 });
    const out = [];
    for (const c of rows) out.push(this.codeView(c, await this.usesOf(c.id)));
    return out;
  }

  /** Codes fondateurs : délivrés par l'équipe, sans propriétaire (premiers chauffeurs). */
  async createFounderCodes(actor: string, label: string, count: number, maxUses: number) {
    const made = [];
    for (let i = 0; i < count; i++) {
      const c = await this.prisma.referralCode.create({ data: { code: newReferralCode(), label, maxUses, issuedBy: actor } });
      made.push(this.codeView(c, 0));
    }
    await this.prisma.auditLog.create({ data: { actor, action: "referral.founder_codes", entity: "ReferralCode", entityId: made[0]?.id ?? "-", data: { label, count, maxUses } as any } });
    return made;
  }

  async revokeCode(id: string, actor: string) {
    const c = await this.prisma.referralCode.findUnique({ where: { id } });
    if (!c) throw new HttpException("Code introuvable", 404);
    await this.prisma.referralCode.update({ where: { id }, data: { revokedAt: c.revokedAt ?? new Date() } });
    await this.prisma.auditLog.create({ data: { actor, action: "referral.revoked", entity: "ReferralCode", entityId: id } });
    return { ok: true };
  }

  /** Arbre de parrainage : qui a fait entrer qui (consultable par l'équipe, par exemple lors d'un audit partenaire). */
  async tree() {
    const drivers = await this.prisma.driver.findMany({
      where: { application: { isNot: null } }, select: { id: true, firstName: true, lastName: true, status: true, sponsorId: true, createdAt: true, application: { select: { referralCode: { select: { label: true, ownerDriverId: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    return drivers.map((d) => ({
      id: d.id, name: `${d.firstName} ${d.lastName}`, status: d.status, sponsorId: d.sponsorId, founder: !d.application?.referralCode.ownerDriverId, founderLabel: d.application?.referralCode.label ?? null,
    }));
  }

  // ---------- chauffeur ----------
  async driverCodes(driverId: string) {
    const t = thresholds();
    const rows = await this.prisma.referralCode.findMany({ where: { ownerDriverId: driverId }, orderBy: { createdAt: "asc" } });
    const codes = [];
    for (const c of rows) codes.push({ code: c.code, revoked: !!c.revokedAt, used: (await this.usesOf(c.id)) >= c.maxUses });
    const live = rows.filter((c) => !c.revokedAt).length;
    const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { status: true } });
    // Prime de parrainage : règle affichée telle quelle au parrain (transparence), et total déjà reçu.
    const rr = referralRewardConfig();
    const earned = await this.prisma.referralReward.aggregate({ _sum: { amountCents: true }, where: { sponsorId: driverId } });
    const reward = rr.enabled ? { amountCents: rr.amountCents, rides: rr.rides, earnedCents: earned._sum.amountCents ?? 0 } : null;
    return { codes, remaining: d.status === "ACTIVE" ? Math.max(0, t.codesPerDriver - live) : 0, canCreate: d.status === "ACTIVE" && live < t.codesPerDriver, reward };
  }

  async createDriverCode(driverId: string) {
    const info = await this.driverCodes(driverId);
    if (!info.canCreate) throw new HttpException("Vous ne pouvez pas créer de code de parrainage pour le moment", 403);
    const c = await this.prisma.referralCode.create({ data: { code: newReferralCode(), ownerDriverId: driverId, maxUses: 1, issuedBy: `driver:${driverId}` } });
    return { code: c.code };
  }
}
