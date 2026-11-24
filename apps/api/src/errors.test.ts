import { HttpException } from "@nestjs/common";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "./app.module";
import { AllExceptionsFilter, ErrorReporter, formatReport } from "./errors";

describe("rapport d'erreur", () => {
  it("met en forme source, message, contexte et trace courte, sans dépasser la limite", () => {
    const t = formatReport({ source: "api", message: "boum", stack: "Error: boum\n  a\n  b\n  c\n  d\n  e", context: { route: "GET /x", status: 500, vide: "", absent: undefined } });
    expect(t).toContain("⚠ CliCab [api] boum");
    expect(t).toContain("route=GET /x · status=500");
    expect(t).not.toContain("vide=");
    expect(t.split("\n").length).toBeLessThanOrEqual(6); // 1 + contexte + 4 lignes de trace
    expect(formatReport({ source: "x", message: "m".repeat(5000) }).length).toBeLessThanOrEqual(1500);
  });

  it("n'envoie rien sans lien d'alerte ; envoie un JSON { text } sinon ; n'envoie pas deux fois le même message dans la fenêtre", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    const r = new ErrorReporter(); r.fetchImpl = f as any;
    r.env = {} as any;
    expect(await r.report({ source: "api", message: "a" })).toBe(false);
    expect(f).not.toHaveBeenCalled();
    r.env = { ERROR_WEBHOOK_URL: "https://hooks.example/abc" } as any;
    expect(await r.report({ source: "api", message: "a" }, 1000)).toBe(true);
    expect(f.mock.calls[0][0]).toBe("https://hooks.example/abc");
    expect(JSON.parse(f.mock.calls[0][1].body).text).toContain("[api] a");
    expect(JSON.parse(f.mock.calls[0][1].body).content).toBe(JSON.parse(f.mock.calls[0][1].body).text); // Discord
    expect(await r.report({ source: "api", message: "a" }, 2000)).toBe(false); // doublon
    expect(await r.report({ source: "api", message: "b" }, 2000)).toBe(true); // autre message
    expect(await r.report({ source: "api", message: "a" }, 1000 + 11 * 60_000)).toBe(true); // fenêtre écoulée
  });

  it("une panne du lien d'alerte ne fait jamais planter l'application", async () => {
    const r = new ErrorReporter(); r.env = { ERROR_WEBHOOK_URL: "https://hooks.example/x" } as any;
    r.fetchImpl = vi.fn().mockRejectedValue(new Error("réseau")) as any;
    await expect(r.report({ source: "api", message: "z" })).resolves.toBe(false);
    r.fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    await expect(r.report({ source: "api", message: "y" })).resolves.toBe(false);
  });
});

describe("filtre global", () => {
  const host = (req: any = { method: "POST", url: "/driver/offers/abc?x=1" }) => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ status: () => ({ json: () => {} }) }) }) }) as any;
  it("signale les erreurs 5xx, pas les erreurs normales", () => {
    const rep = new ErrorReporter(); const spy = vi.spyOn(rep, "report").mockResolvedValue(true);
    const filter = new AllExceptionsFilter(rep);
    const base = vi.spyOn(Object.getPrototypeOf(AllExceptionsFilter.prototype), "catch").mockImplementation(() => {});
    try {
    filter.catch(new HttpException("non trouvé", 404), host());
    filter.catch(new HttpException("invalide", 422), host());
    expect(spy).not.toHaveBeenCalled();
    filter.catch(new Error("base injoignable"), host());
    filter.catch(new HttpException("panne", 503), host());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toMatchObject({ source: "api", message: "base injoignable", context: { route: "POST /driver/offers/abc", status: 500 } });
    expect(base).toHaveBeenCalledTimes(4); // la réponse normale est toujours produite par le filtre de base
    } finally { base.mockRestore(); } // sinon le serveur de la suite suivante ne répondrait plus aux erreurs
  });
});

describe("plantages de l'application chauffeur", () => {
  const prisma = new PrismaClient();
  let app: INestApplication; let base: string; let rep: ErrorReporter;
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    rep = app.get(ErrorReporter);
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });
  beforeEach(async () => { await prisma.$executeRawUnsafe('TRUNCATE "Incident","IdentityCheck","DriverPenalty","Notification","OtpCode","Document","Vehicle","Driver","AuditLog" CASCADE'); });

  async function driverToken() {
    const n = Math.floor(Math.random() * 9000) + 1000;
    const r = await fetch(base + "/admin/drivers", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "test-admin-token-test-admin-token" }, body: JSON.stringify({ firstName: "Ana", lastName: "Test", phone: `+3361000${n}`, email: `e${n}@test.fr` }) });
    const d = await r.json();
    const l = await fetch(base + "/driver/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: d.phone, code: "000000" }) });
    return (await l.json()).token as string;
  }
  const post = (token: string | null, body: unknown) => fetch(base + "/driver/client-error", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

  it("enregistre le plantage, prévient l'équipe, et exige d'être connecté", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true }); rep.fetchImpl = f as any; rep.env = { ERROR_WEBHOOK_URL: "https://hooks.example/t" } as any;
    expect((await post(null, { message: "x" })).status).toBe(401);
    const t = await driverToken();
    expect((await post(t, { message: "" })).status).toBe(422);
    const r = await post(t, { label: "Photo-preuve", message: "Cannot read properties of null (reading 'useRef')", stack: "TypeError: …\n at usePermission", platform: "web", fatal: true });
    expect(r.status).toBe(201);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entity: "ClientError" } });
    expect(row.action).toBe("client.crash");
    expect(JSON.parse(f.mock.calls[0][1].body).text).toContain("[app/Photo-preuve] Cannot read properties of null");
  });

  it("limite les rapports par chauffeur", async () => {
    process.env.CLIENT_ERRORS_PER_HOUR = "2";
    rep.env = {} as any;
    const t = await driverToken();
    // le limiteur du contrôleur lit la variable à chaque appel : on repart d'un chauffeur neuf
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(t, { message: `e${i}` })).status);
    delete process.env.CLIENT_ERRORS_PER_HOUR;
    expect(codes).toEqual([201, 201, 429, 429]);
  });
});
