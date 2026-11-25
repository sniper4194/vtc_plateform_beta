import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { parse } from "./http";
import { PROOF_KINDS } from "./proof";
import { ProofService } from "./proof.service";
import { AdminGuard, DriverGuard, PartnerGuard } from "./security";

const ProofSchema = z.object({
  kind: z.enum(PROOF_KINDS), image: z.string().min(100).max(1_000_000),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100_000).optional(),
  address: z.string().max(300).optional(), capturedAt: z.string().datetime({ offset: true }).optional(), note: z.string().max(300).optional(),
});
const send = (res: any, p: { mime: string; image: Buffer }) => res.set({ "Content-Type": p.mime, "Cache-Control": "private, no-store" }).send(p.image);

@Controller("driver/rides/:rideId/proofs")
@UseGuards(DriverGuard)
export class DriverProofController {
  constructor(@Inject(ProofService) private proofs: ProofService) {}
  @Post() create(@Req() req: any, @Param("rideId") rideId: string, @Body() body: unknown) { return this.proofs.create(req.driverId, rideId, parse(ProofSchema, body)); }
  @Get() list(@Req() req: any, @Param("rideId") rideId: string) { return this.proofs.listForDriver(req.driverId, rideId); }
  @Get(":proofId/photo") async photo(@Req() req: any, @Param("rideId") rideId: string, @Param("proofId") proofId: string, @Res() res: any) {
    send(res, await this.proofs.photoForDriver(req.driverId, rideId, proofId));
  }
}

/** Preuves visibles par le partenaire dont la réservation est concernée (par exemple pour justifier un client absent ou un excédent de bagages). */
@Controller("v1/bookings/:id/proofs")
@UseGuards(PartnerGuard)
export class PartnerProofController {
  constructor(@Inject(ProofService) private proofs: ProofService) {}
  @Get() list(@Req() req: any, @Param("id") id: string) { return this.proofs.listForPartner(req.partner.id, id); }
  @Get(":proofId/photo") async photo(@Req() req: any, @Param("id") id: string, @Param("proofId") proofId: string, @Res() res: any) {
    send(res, await this.proofs.photoForPartner(req.partner.id, id, proofId));
  }
}

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminProofController {
  constructor(@Inject(ProofService) private proofs: ProofService) {}
  @Get("rides/:rideId/proofs") list(@Param("rideId") rideId: string) { return this.proofs.listForAdmin(rideId); }
  @Get("proofs/:proofId/photo") async photo(@Param("proofId") proofId: string, @Res() res: any) { send(res, await this.proofs.photoForAdmin(proofId)); }
}
