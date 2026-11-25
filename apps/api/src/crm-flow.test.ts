import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { config, signToken } from "./security";
const prisma = new PrismaClient();
let app: INestApplication;
let base: string;
async function call(path: string, body?: unknown, auth = "admin") {
  const headers: Record<string,string> = { "content-type": "application/json" };
  if (auth === "admin") headers["x-admin-token"] = "test-admin-token-test-admin-token";
  else if (auth !== "none") headers.authorization = "Bearer " + auth;
  const res = await fetch(base + "/admin/crm" + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}
beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = "http://127.0.0.1:" + (app.getHttpServer().address() as AddressInfo).port;
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "CrmAccount","CrmInteraction","Partner","Booking","Ride","RideEvent","AuditLog","AdminUser" CASCADE');
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
const prospect = { name: "Hotel Test", kind: "HOTEL", stage: "PROSPECT" };
const ago = (days: number) => new Date(Date.now() - days * 86400_000);
describe("CRM — intégration API et PostgreSQL", () => {
  it("protège les fiches et journalise la clôture d'une relance", async () => {
    expect((await call("", undefined, "none")).status).toBe(401);
    const dispatcher = await prisma.adminUser.create({ data: { email: "crm-dispatcher@test.fr", name: "Dispatcher", passwordHash: "unused", role: "DISPATCHER" } });
    const token = signToken({ sub: dispatcher.id, role: "admin", tv: dispatcher.tokenVersion }, config.tokenSecret, 3600);
    expect((await call("", undefined, token)).status).toBe(403);
    expect((await call("", prospect, token)).status).toBe(403);
    const at = ago(1).toISOString();
    const c = await call("", { ...prospect, nextAction: "Rappeler", nextActionAt: at });
    expect(c.status).toBe(201);
    const id = c.json.id;
    expect((await call("?overdue=1")).json.overdue).toBe(1);
    expect((await call("/" + id + "/follow-up/complete", { action: "Autre", at })).status).toBe(409);
    expect((await call("/" + id + "/follow-up/complete", { action: "Rappeler", at })).status).toBe(201);
    expect((await call("/" + id + "/follow-up/complete", { action: "Rappeler", at })).status).toBe(409);
    expect((await call("?overdue=1")).json.overdue).toBe(0);
    const d = (await call("/" + id)).json;
    expect(d.nextActionAt).toBeNull();
    expect(d.interactions).toHaveLength(1);
    expect(d.interactions[0].note).toContain("Rappeler");
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "crm.follow_up_completed" } })).toBe(1);
  });
  it("isole partenaires, périodes et simulations ; conserve le partenaire à la suppression", async () => {
    const p = await prisma.partner.create({ data: { name: "Partenaire réel" } });
    const other = await prisma.partner.create({ data: { name: "Autre" } });
    const account = await call("", { ...prospect, partnerId: p.id });
    expect(account.status).toBe(201);
    const id = account.json.id;
    expect((await call("", { ...prospect, partnerId: p.id })).status).toBe(409);
    async function ride(partnerId: string, days: number, sandbox: boolean | null, cancelled = false) {
      const booking = await prisma.booking.create({ data: { partnerId, passengerFirstName: "Test", passengerLastName: "Test", passengerPhone: "+33600000000" } });
      const r = await prisma.ride.create({ data: {
        bookingId: booking.id, status: cancelled ? "CANCELLED_BY_CLIENT" : "COMPLETED", category: "BERLINE",
        pickupAddress: "A", pickupLat: 48, pickupLng: 2, dropoffAddress: "B", dropoffLat: 49, dropoffLng: 2,
        pickupAt: ago(days), distanceKm: 10, durationMin: 20, priceCents: 10000, commissionCents: 2000, driverNetCents: 8000,
        ...(cancelled ? { cancelledAt: ago(days), cancellationFeeCents: 3000, driverCompensationCents: 2000 } : {}),
      } });
      if (sandbox !== null) await prisma.rideEvent.create({ data: { rideId: r.id, type: "booking.confirmed", payload: { sandbox } } });
    }
    await ride(p.id, 5, false);
    await ride(p.id, 8, false, true);
    await ride(p.id, 40, false);
    await ride(p.id, 2, true);
    await ride(p.id, 2, null);
    await ride(other.id, 2, false);
    const a = await call("/" + id + "/activity?days=30");
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ linked: true, completed: 1, cancelled: 1, grossCents: 13000, driverCents: 10000, spreadCents: 3000 });
    expect((await call("/" + id + "/activity?days=90")).json).toMatchObject({ completed: 2, grossCents: 23000 });
    expect((await call("/" + id + "/activity?days=1")).status).toBe(422);
    expect((await call("/" + id + "/delete", {})).status).toBe(201);
    expect(await prisma.partner.count({ where: { id: p.id } })).toBe(1);
    expect(await prisma.booking.count({ where: { partnerId: p.id } })).toBe(5);
  });
});
