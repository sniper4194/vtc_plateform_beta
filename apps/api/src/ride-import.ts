import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Partner } from "@prisma/client";
import { z } from "zod";
import { BookingsService } from "./bookings.service";
import { FIELD_LABEL, guessMapping, IMPORT_FIELDS, type Mapping, parseCsv, toDraft } from "./csv-import";
import { GeocodeService } from "./geocode";
import { parse } from "./http";
import { minDriverPayCents } from "./ladder";
import { PrismaService } from "./prisma";
import { QuotesService } from "./quotes.service";
import { AdminGuard, type AdminIdentity } from "./security";

const MAX_ROWS = 500;
const MappingSchema = z.record(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(200)).optional();
const FileSchema = z.object({
  partnerId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200).default("import.csv"),
  csv: z.string().min(1).max(900_000), // limite de corps de requête : 1 Mo
  mapping: MappingSchema,
}).strict();

/** Ce qui est montré au dispatcheur pour une ligne (sans le brouillon complet). */
function summary(d: ReturnType<typeof toDraft>) {
  return {
    reference: d.reference, pickupAt: d.pickupAt?.toISOString() ?? null, pickup: d.pickupAddress, dropoff: d.dropoffAddress,
    passenger: `${d.firstName} ${d.lastName}`.trim(), flightNumber: d.flightNumber, passengers: d.passengers,
    priceCents: d.priceCents, category: d.category, errors: d.errors,
  };
}

@Injectable()
export class RideImportService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(QuotesService) private quotes: QuotesService,
    @Inject(BookingsService) private bookings: BookingsService,
    @Inject(GeocodeService) private geo: GeocodeService,
  ) {}

  private async partner(id: string): Promise<Partner> {
    const p = await this.prisma.partner.findUnique({ where: { id } });
    if (!p || !p.active) throw new HttpException("Donneur d'ordre introuvable ou inactif", 404);
    return p;
  }

  private read(csv: string, saved: unknown, given?: Mapping) {
    const { headers, rows } = parseCsv(csv);
    if (!headers.length) throw new HttpException("Fichier vide", 422);
    if (rows.length > MAX_ROWS) throw new HttpException(`Fichier trop long : ${MAX_ROWS} courses au plus par import`, 422);
    // Correspondance : celle choisie à l'écran, sinon celle mémorisée pour ce donneur d'ordre si elle tient dans ce fichier, sinon devinée.
    const savedOk = saved && Object.values(saved as Mapping).every((i) => typeof i === "number" && i < headers.length) ? (saved as Mapping) : null;
    const mapping: Mapping = given ?? savedOk ?? guessMapping(headers);
    return { headers, rows, mapping };
  }

  async preview(body: unknown) {
    const b = parse(FileSchema, body);
    const p = await this.partner(b.partnerId);
    const { headers, rows, mapping } = this.read(b.csv, p.csvMapping, b.mapping);
    const drafts = rows.map((r) => toDraft(r, mapping));
    const refs = drafts.map((d) => d.reference).filter((x): x is string => !!x);
    const existing = refs.length
      ? await this.prisma.importedRide.findMany({ where: { partnerId: p.id, reference: { in: refs } }, select: { reference: true, status: true } })
      : [];
    const known = new Map(existing.map((e) => [e.reference, e.status]));
    return {
      headers, mapping, fields: IMPORT_FIELDS.map((f) => ({ field: f, label: FIELD_LABEL[f] })),
      rows: drafts.map((d, i) => ({ line: i + 2, ...summary(d), already: d.reference ? known.get(d.reference) ?? null : null })),
    };
  }

  /** Enregistre les lignes en attente (hors Radar). Une référence déjà en attente est mise à jour ; déjà publiée, elle est ignorée. */
  async import(body: unknown, admin: AdminIdentity) {
    const b = parse(FileSchema, body);
    const p = await this.partner(b.partnerId);
    const { rows, mapping } = this.read(b.csv, p.csvMapping, b.mapping);
    const drafts = rows.map((r) => toDraft(r, mapping));
    let created = 0, updated = 0, skipped = 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.partner.update({ where: { id: p.id }, data: { csvMapping: mapping as any } });
      const imp = await tx.rideImport.create({ data: { partnerId: p.id, fileName: b.fileName, createdBy: admin.actor } });
      for (const d of drafts) {
        const data = JSON.parse(JSON.stringify(d)) as any;
        const row = { data, errors: d.errors, pickupAt: d.pickupAt };
        const prev = d.reference ? await tx.importedRide.findUnique({ where: { partnerId_reference: { partnerId: p.id, reference: d.reference } } }) : null;
        if (prev && prev.status !== "PENDING") { skipped++; continue; }
        if (prev) { await tx.importedRide.update({ where: { id: prev.id }, data: { ...row, importId: imp.id } }); updated++; }
        else { await tx.importedRide.create({ data: { ...row, importId: imp.id, partnerId: p.id, reference: d.reference } }); created++; }
      }
    });
    return { created, updated, skipped };
  }

  async pending() {
    const rows = await this.prisma.importedRide.findMany({
      where: { status: "PENDING" }, include: { partner: { select: { name: true } } }, orderBy: [{ pickupAt: "asc" }, { createdAt: "asc" }], take: 300,
    });
    return rows.map((r) => ({ id: r.id, partner: r.partner.name, ...summary({ ...(r.data as any), pickupAt: r.pickupAt, errors: r.errors }) }));
  }

  /** Met une ligne au Radar : devis (grille CliCab, ou prix du fichier), réservation, puis dispatch habituel. */
  async publish(id: string, admin: AdminIdentity) {
    const row = await this.prisma.importedRide.findUnique({ where: { id }, include: { partner: true } });
    if (!row || row.status !== "PENDING") throw new HttpException("Course importée introuvable ou déjà traitée", 409);
    if (row.errors.length) throw new HttpException(`À corriger dans le fichier puis réimporter : ${row.errors.join(", ")}`, 422);
    const d = row.data as any;
    const pickupAt = row.pickupAt!;
    if (pickupAt.getTime() <= Date.now()) throw new HttpException("Prise en charge déjà passée", 422);
    const [pickup, dropoff] = await Promise.all([
      d.pickupCoords ?? this.geo.locate(d.pickupAddress), d.dropoffCoords ?? this.geo.locate(d.dropoffAddress),
    ]);
    if (!pickup || !dropoff) {
      const which = [!pickup && `départ (« ${d.pickupAddress} »)`, !dropoff && `arrivée (« ${d.dropoffAddress} »)`].filter(Boolean).join(" et ");
      throw new HttpException(`Adresse introuvable : ${which}. Précisez-la (numéro, rue, ville) dans le fichier puis réimportez.`, 422);
    }
    // Une seule publication, même en cas de double clic : la ligne est réservée avant de créer la course.
    const claimed = await this.prisma.importedRide.updateMany({ where: { id, status: "PENDING" }, data: { status: "PUBLISHED", publishedBy: admin.actor, publishedAt: new Date() } });
    if (claimed.count !== 1) throw new HttpException("Course déjà mise au Radar", 409);
    try {
      const partner = row.partner;
      const q = await this.quotes.create(partner, {
        pickup: { address: d.pickupAddress, ...pickup }, dropoff: { address: d.dropoffAddress, ...dropoff },
        pickupAt: pickupAt.toISOString(), category: d.category, passengers: d.passengers, luggage: d.luggage,
        ...(d.flightNumber ? { flightNumber: d.flightNumber } : {}),
      });
      if (d.priceCents) {
        // Prix fixé par le donneur d'ordre dans son fichier : la commission CliCab s'applique dessus (taux du partenaire), revenu minimal garanti.
        const commission = Math.round(d.priceCents * Number(partner.commissionRate));
        const driverNetCents = Math.max(d.priceCents - commission, minDriverPayCents());
        await this.prisma.quote.update({ where: { id: q.quoteId }, data: { priceCents: d.priceCents, driverNetCents, commissionCents: d.priceCents - driverNetCents } });
      }
      const phone: string = d.phone;
      const res = await this.bookings.create(partner, `import-${row.id}`, {
        quoteId: q.quoteId, externalReference: d.reference ?? undefined, notes: d.notes ?? undefined, signText: d.signText ?? undefined,
        passenger: { firstName: d.firstName, lastName: d.lastName, phone, email: d.email ?? undefined, language: /^(\+33|0033|0)/.test(phone.replace(/\s/g, "")) ? "fr" : "en" },
      }, false);
      const booking = res.booking as { rideId: string; reference: string };
      await this.prisma.importedRide.update({ where: { id }, data: { rideId: booking.rideId } });
      return { rideId: booking.rideId, reference: booking.reference };
    } catch (e) {
      await this.prisma.importedRide.update({ where: { id }, data: { status: "PENDING", publishedBy: null, publishedAt: null } });
      throw e;
    }
  }

  /** Écarte une ligne : les données du voyageur sont effacées (on ne garde que la référence, pour reconnaître un doublon). */
  async discard(id: string) {
    const res = await this.prisma.importedRide.updateMany({ where: { id, status: "PENDING" }, data: { status: "DISCARDED", data: {}, errors: [], pickupAt: null } });
    if (res.count !== 1) throw new HttpException("Course importée introuvable ou déjà traitée", 409);
    return { status: "DISCARDED" };
  }
}

@Controller("admin/imports")
@UseGuards(AdminGuard)
export class AdminRideImportController {
  constructor(@Inject(RideImportService) private svc: RideImportService) {}
  @Post("preview") preview(@Body() body: unknown) { return this.svc.preview(body); }
  @Post() run(@Req() req: { admin: AdminIdentity }, @Body() body: unknown) { return this.svc.import(body, req.admin); }
  @Get("rides") pending(@Query("status") _status?: string) { return this.svc.pending(); }
  @Post("rides/:id/publish") publish(@Req() req: { admin: AdminIdentity }, @Param("id") id: string) { return this.svc.publish(id, req.admin); }
  @Post("rides/:id/discard") discard(@Param("id") id: string) { return this.svc.discard(id); }
}
