import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { RecruitmentService } from "./recruitment.service";
import { ApplyController } from "./recruitment.controller";
import { SlidingLimiter } from "./hardening";
import { newReferralCode, normalizeCode, readiness, thresholds } from "./recruitment";

const prisma = new PrismaClient();
let app: INestApplication;
let base: string;

async function call(path: string, opts: { method?: string; token?: string; admin?: boolean; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.admin ? { "x-admin-token": "test-admin-token-test-admin-token" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Application","ReferralCode","Incident","IdentityCheck","DriverPenalty","Notification","OtpCode","Document","Vehicle","Driver","AuditLog" CASCADE');
});

const founderCode = async (label = "Fondateur test", count = 1, maxUses = 1) => (await call("/admin/applications/codes", { admin: true, body: { label, count, maxUses } })).json as { id: string; code: string }[];
let seq = 0;
const candidate = (code: string, over: Record<string, unknown> = {}) => {
  const n = ++seq;
  return { firstName: "Luis", lastName: "Fernandes", phone: `+3361111${String(n).padStart(4, "0")}`, email: `k${n}@test.fr`, yearsExperience: 6, otherPlatforms: [{ name: "Autre plateforme", rating: 4.9 }], referralCode: code, consent: true, ...over };
};
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

/** Passe toutes les étapes avec succès. */
async function fullReview(id: string) {
  const adm = { admin: true };
  expect((await call(`/admin/applications/${id}/checks`, { ...adm, body: { cardProValidUntil: inDays(400), licencePoints: 11, licenceNoSuspension: true, honorStatement: true } })).status).toBe(201);
  expect((await call(`/admin/applications/${id}/tests`, { ...adm, body: { frenchScore: 80, englishLevel: "B2", ethicsScore: 85 } })).status).toBe(201);
  expect((await call(`/admin/applications/${id}/interview`, { ...adm, body: { notes: "Entretien concluant, discours cohérent." } })).status).toBe(201);
}

describe("règles pures", () => {
  it("génère des codes lisibles et normalise la saisie", () => {
    expect(newReferralCode()).toMatch(/^CLI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeCode(" cli-ab2c-d3ef ")).toBe("CLI-AB2C-D3EF");
  });
  it("liste précisément ce qui manque", () => {
    const empty = readiness({ yearsExperience: 5, cardProValidUntil: null, licenceCheckedAt: null, licencePointsOk: null, licenceNoSuspension: null, honorStatementAt: null, frenchScore: null, englishLevel: null, ethicsScore: null, interviewAt: null });
    expect(empty).toHaveLength(7);
    const t = thresholds();
    const now = new Date();
    const low = readiness({ yearsExperience: 5, cardProValidUntil: new Date(now.getTime() + 400 * 86400_000), licenceCheckedAt: now, licencePointsOk: false, licenceNoSuspension: true, honorStatementAt: now, frenchScore: t.minFrench - 1, englishLevel: "A2", ethicsScore: t.minEthics, interviewAt: now });
    expect(low).toEqual([`Permis : moins de ${t.minPoints} points`, `Test de français : ${t.minFrench - 1}/100 (minimum ${t.minFrench})`, `Anglais : A2 (minimum ${t.minEnglish})`]);
  });
  it("refuse une carte professionnelle bientôt expirée", () => {
    const now = new Date();
    const m = readiness({ yearsExperience: 5, cardProValidUntil: new Date(now.getTime() + 5 * 86400_000), licenceCheckedAt: now, licencePointsOk: true, licenceNoSuspension: true, honorStatementAt: now, frenchScore: 90, englishLevel: "C1", ethicsScore: 90, interviewAt: now });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/Carte professionnelle/);
  });
});

describe("dépôt de candidature", () => {
  it("exige un code de parrainage valide, sans révéler quels codes existent", async () => {
    const [c] = await founderCode();
    const bad = await call("/apply", { body: candidate("CLI-ZZZZ-ZZZZ") });
    expect(bad.status).toBe(422);
    expect(bad.json.message).toBe("Code de parrainage invalide ou déjà utilisé");
    expect((await call("/apply", { body: candidate(c.code) })).status).toBe(201);
    // code à usage unique : déjà pris
    const again = await call("/apply", { body: candidate(c.code) });
    expect(again.status).toBe(422);
    expect(again.json.message).toBe(bad.json.message);
  });

  it("exige le consentement et refuse les doublons en cours", async () => {
    const [a, b] = await founderCode("Lot", 2);
    expect((await call("/apply", { body: candidate(a.code, { consent: false }) })).status).toBe(422);
    const body = candidate(a.code);
    expect((await call("/apply", { body })).status).toBe(201);
    const dup = await call("/apply", { body: { ...body, referralCode: b.code } });
    expect(dup.status).toBe(409);
  });

  it("n'enregistre ni code révoqué, ni code d'un autre usage au-delà de son quota", async () => {
    const [a] = await founderCode("Révoqué");
    await call(`/admin/applications/codes/${a.id}/revoke`, { admin: true, body: {} });
    expect((await call("/apply", { body: candidate(a.code) })).status).toBe(422);
    const [m] = await founderCode("Multi", 1, 2);
    expect((await call("/apply", { body: candidate(m.code) })).status).toBe(201);
    expect((await call("/apply", { body: candidate(m.code) })).status).toBe(201);
    expect((await call("/apply", { body: candidate(m.code) })).status).toBe(422);
  });

  it("limite les dépôts par adresse IP", async () => {
    const before = process.env.APPLY_IP_PER_HOUR;
    process.env.APPLY_IP_PER_HOUR = "2";
    (app.get(ApplyController) as any).limiter = new SlidingLimiter(); // repart d'un compteur vide
    try {
      const codes = await founderCode("IP", 4);
      const s = [];
      for (const c of codes) s.push((await call("/apply", { body: candidate(c.code) })).status);
      expect(s.slice(0, 2)).toEqual([201, 201]);
      expect(s.slice(2)).toEqual([429, 429]);
    } finally { process.env.APPLY_IP_PER_HOUR = before; }
  });

  it("est réservé aux administrateurs pour la lecture et la décision", async () => {
    const [c] = await founderCode();
    const r = await call("/apply", { body: candidate(c.code) });
    expect(r.status).toBe(201);
    expect((await call("/admin/applications")).status).toBe(401);
    const list = await call("/admin/applications", { admin: true });
    expect(list.json).toHaveLength(1);
    expect(list.json[0].missing.length).toBeGreaterThan(0);
  });
});

describe("vérifications et décision", () => {
  async function submitted() {
    const [c] = await founderCode();
    await call("/apply", { body: candidate(c.code) });
    return (await prisma.application.findFirstOrThrow()).id;
  }

  it("n'enregistre que le résultat du contrôle du permis, jamais le nombre de points", async () => {
    const id = await submitted();
    const r = await call(`/admin/applications/${id}/checks`, { admin: true, body: { licencePoints: 7, licenceNoSuspension: true } });
    expect(r.json.checks.licencePointsOk).toBe(false); // seuil par défaut : 8
    expect(JSON.stringify(r.json)).not.toMatch(/"licencePoints"/);
    const row = await prisma.application.findUniqueOrThrow({ where: { id } });
    expect(row.licencePointsOk).toBe(false);
    expect(r.json.status).toBe("IN_REVIEW");
    expect(r.json.missing.some((m: string) => m.includes("moins de 8 points"))).toBe(true);
    // il faut les deux informations
    expect((await call(`/admin/applications/${id}/checks`, { admin: true, body: { licencePoints: 12 } })).status).toBe(422);
    const ok = await call(`/admin/applications/${id}/checks`, { admin: true, body: { licencePoints: 8, licenceNoSuspension: true } });
    expect(ok.json.checks.licencePointsOk).toBe(true);
  });

  it("refuse d'accepter tant qu'un critère manque, sans dérogation", async () => {
    const id = await submitted();
    const early = await call(`/admin/applications/${id}/accept`, { admin: true, body: {} });
    expect(early.status).toBe(409);
    expect(early.json.missing.length).toBe(7);
    await call(`/admin/applications/${id}/checks`, { admin: true, body: { cardProValidUntil: inDays(400), licencePoints: 12, licenceNoSuspension: true, honorStatement: true } });
    await call(`/admin/applications/${id}/tests`, { admin: true, body: { frenchScore: 40, englishLevel: "B1", ethicsScore: 90 } });
    await call(`/admin/applications/${id}/interview`, { admin: true, body: { notes: "Échange correct." } });
    const low = await call(`/admin/applications/${id}/accept`, { admin: true, body: {} });
    expect(low.status).toBe(409);
    expect(low.json.missing).toEqual(["Test de français : 40/100 (minimum 60)"]);
    expect(await prisma.driver.count()).toBe(0);
  });

  it("accepte, crée le compte chauffeur et trace la décision", async () => {
    const id = await submitted();
    await fullReview(id);
    const detail = await call(`/admin/applications/${id}`, { admin: true });
    expect(detail.json.ready).toBe(true);
    const acc = await call(`/admin/applications/${id}/accept`, { admin: true, body: {} });
    expect(acc.status).toBe(201);
    const d = await prisma.driver.findUniqueOrThrow({ where: { id: acc.json.driverId } });
    expect(d.status).toBe("PENDING_DOCUMENTS"); // il reste à fournir ses documents et son véhicule
    expect(d.sponsorId).toBeNull(); // code fondateur
    const after = await call(`/admin/applications/${id}`, { admin: true });
    expect(after.json.status).toBe("ACCEPTED");
    expect(after.json.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(["application.submitted", "application.checks", "application.tests", "application.interview", "application.accepted"]));
    expect(after.json.history.find((h: any) => h.action === "application.accepted").actor).toBe("service");
    // une candidature clôturée ne se modifie plus
    expect((await call(`/admin/applications/${id}/tests`, { admin: true, body: { frenchScore: 10 } })).status).toBe(409);
  });

  it("refuse avec un motif, empêche de redéposer trop tôt, puis l'autorise", async () => {
    const [c1, c2] = await founderCode("Lot", 2);
    const body = candidate(c1.code);
    await call("/apply", { body });
    const id = (await prisma.application.findFirstOrThrow()).id;
    expect((await call(`/admin/applications/${id}/reject`, { admin: true, body: { reason: "ok" } })).status).toBe(422); // motif trop court
    const rej = await call(`/admin/applications/${id}/reject`, { admin: true, body: { reason: "Entretien : réponses non conformes à l'éthique attendue" } });
    expect(rej.json.status).toBe("REJECTED");
    expect(rej.json.decision.reason).toMatch(/éthique/);
    // le code est libéré par le refus
    const too = await call("/apply", { body: { ...body, referralCode: c2.code } });
    expect(too.status).toBe(409);
    expect(too.json.message).toMatch(/moins de 30 jours/);
    await prisma.application.update({ where: { id }, data: { decidedAt: new Date(Date.now() - 31 * 86400_000) } });
    expect((await call("/apply", { body: { ...body, referralCode: c1.code } })).status).toBe(201); // code libéré
  });
});

describe("parrainage", () => {
  async function activeDriver() {
    const [c] = await founderCode("Fondateur Sophie");
    await call("/apply", { body: candidate(c.code) });
    const id = (await prisma.application.findFirstOrThrow()).id;
    await fullReview(id);
    const { driverId } = (await call(`/admin/applications/${id}/accept`, { admin: true, body: {} })).json;
    const d = await prisma.driver.update({ where: { id: driverId }, data: { status: "ACTIVE" } });
    const login = await call("/driver/login", { body: { phone: d.phone, code: "000000" } });
    return { id: driverId as string, token: login.json.token as string };
  }

  it("un chauffeur actif crée des codes (3 au plus) et ses filleuls lui sont rattachés", async () => {
    const parrain = await activeDriver();
    expect((await call("/driver/referral", { token: parrain.token })).json).toMatchObject({ canCreate: true, remaining: 3, codes: [] });
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await call("/driver/referral", { token: parrain.token, body: {} })).json.code);
    expect((await call("/driver/referral", { token: parrain.token, body: {} })).status).toBe(403);
    expect((await call("/driver/referral", { token: parrain.token })).json.remaining).toBe(0);

    const r = await call("/apply", { body: candidate(made[0]) });
    expect(r.status).toBe(201);
    const filleul = (await prisma.application.findFirstOrThrow({ where: { referralCode: { code: made[0] } } })).id;
    await fullReview(filleul);
    const acc = await call(`/admin/applications/${filleul}/accept`, { admin: true, body: {} });
    const d = await prisma.driver.findUniqueOrThrow({ where: { id: acc.json.driverId } });
    expect(d.sponsorId).toBe(parrain.id);
    const detail = await call(`/admin/applications/${filleul}`, { admin: true });
    expect(detail.json.sponsor).toMatchObject({ founder: false, driver: { id: parrain.id, name: "Luis Fernandes" } });

    const tree = (await call("/admin/applications/tree", { admin: true })).json;
    expect(tree).toHaveLength(2);
    expect(tree.find((t: any) => t.id === acc.json.driverId)).toMatchObject({ sponsorId: parrain.id, founder: false });
    expect(tree.find((t: any) => t.id === parrain.id)).toMatchObject({ sponsorId: null, founder: true, founderLabel: "Fondateur Sophie" });
  });

  it("un chauffeur non actif ne peut pas créer de codes", async () => {
    const p = await activeDriver();
    await prisma.driver.update({ where: { id: p.id }, data: { status: "SUSPENDED" } });
    expect((await call("/driver/referral", { token: p.token, body: {} })).status).toBe(403);
    expect((await call("/driver/referral", { token: p.token })).json.remaining).toBe(0);
  });
});

describe("conservation des données", () => {
  it("rend anonymes les candidatures refusées anciennes, jamais les acceptées", async () => {
    const [a, b] = await founderCode("Lot", 2);
    await call("/apply", { body: candidate(a.code) });
    await call("/apply", { body: candidate(b.code) });
    const [x, y] = await prisma.application.findMany({ orderBy: { createdAt: "asc" } });
    await call(`/admin/applications/${x.id}/reject`, { admin: true, body: { reason: "Critères non remplis (test)" } });
    await prisma.application.update({ where: { id: x.id }, data: { updatedAt: new Date(Date.now() - 200 * 86400_000) } });
    const svc = app.get(RecruitmentService);
    expect(await svc.sweep()).toBe(1);
    const gone = await prisma.application.findUniqueOrThrow({ where: { id: x.id } });
    expect(gone.firstName).toBe("—");
    expect(gone.email).toMatch(/@anonyme\.invalid$/);
    expect(gone.anonymizedAt).not.toBeNull();
    const kept = await prisma.application.findUniqueOrThrow({ where: { id: y.id } });
    expect(kept.firstName).toBe("Luis");
    // l'effacement à la demande est refusé si un compte chauffeur y est lié
    await fullReviewAndAccept(y.id);
    expect((await call(`/admin/applications/${y.id}/anonymize`, { admin: true, body: {} })).status).toBe(409);
  });
});

async function fullReviewAndAccept(id: string) {
  await fullReview(id);
  expect((await call(`/admin/applications/${id}/accept`, { admin: true, body: {} })).status).toBe(201);
}
