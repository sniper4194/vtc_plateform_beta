import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { parse } from "./http";
import { RescueService } from "./rescue.service";
import { AdminGuard, AdminOnly, DriverGuard } from "./security";

const RequestSchema = z.object({ rideId: z.string().uuid(), targetId: z.string().uuid().optional(), reason: z.string().trim().min(3).max(300) });

@Controller("driver/rescue")
@UseGuards(DriverGuard)
export class RescueController {
  constructor(@Inject(RescueService) private rescue: RescueService) {}

  @Get("status") status(@Req() req: any) { return this.rescue.status(req.driverId); }
  @Post("opt-in") optIn(@Req() req: any, @Body() body: unknown) { return this.rescue.setOptIn(req.driverId, parse(z.object({ enabled: z.boolean() }), body).enabled); }
  @Get("rescuers") rescuers(@Req() req: any, @Query("rideId") rideId: string) { return this.rescue.rescuers(req.driverId, rideId); }
  @Get("incoming") incoming(@Req() req: any) { return this.rescue.incoming(req.driverId); }
  @Get("mine") mine(@Req() req: any) { return this.rescue.mine(req.driverId); }
  @Post("request") request(@Req() req: any, @Body() body: unknown) { const b = parse(RequestSchema, body); return this.rescue.request(req.driverId, b.rideId, b); }
  @Post(":id/accept") accept(@Req() req: any, @Param("id") id: string) { return this.rescue.accept(req.driverId, id); }
  @Post(":id/decline") decline(@Req() req: any, @Param("id") id: string) { return this.rescue.decline(req.driverId, id); }
  @Post(":id/cancel") cancel(@Req() req: any, @Param("id") id: string) { return this.rescue.cancel(req.driverId, id); }
}

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminRescueController {
  constructor(@Inject(RescueService) private rescue: RescueService) {}

  @Get("rescues") list(@Query("open") open?: string) { return this.rescue.adminList(open === "1"); }
  @Post("drivers/:id/rescue-revoke") @AdminOnly() revoke(@Req() req: any, @Param("id") id: string) { return this.rescue.adminSetRevoked(id, true, req.admin.actor); }
  @Post("drivers/:id/rescue-restore") @AdminOnly() restore(@Req() req: any, @Param("id") id: string) { return this.rescue.adminSetRevoked(id, false, req.admin.actor); }
}
