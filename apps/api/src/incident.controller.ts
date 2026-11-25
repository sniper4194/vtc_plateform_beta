import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { IncidentService } from "./incident.service";
import { parse } from "./http";
import { AdminGuard, AdminOnly, DriverGuard } from "./security";

const CreateSchema = z.object({
  kind: z.enum(["DANGER", "ACCIDENT", "BREAKDOWN", "CLIENT", "PAYMENT", "CONTROL", "OTHER"]),
  rideId: z.string().uuid().optional(), message: z.string().max(500).optional(), urgent: z.boolean().optional(),
  lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
});

@Controller("driver/incidents")
@UseGuards(DriverGuard)
export class IncidentController {
  constructor(@Inject(IncidentService) private incidents: IncidentService) {}
  @Post() create(@Req() req: any, @Body() body: unknown) { return this.incidents.create(req.driverId, parse(CreateSchema, body)); }
  @Get() mine(@Req() req: any) { return this.incidents.mine(req.driverId); }
}

@Controller("admin/incidents")
@UseGuards(AdminGuard)
export class AdminIncidentController {
  constructor(@Inject(IncidentService) private incidents: IncidentService) {}
  @Get() list(@Query("status") status?: string) { return this.incidents.adminList(status); }
  @Post(":id/ack") @AdminOnly() ack(@Req() req: any, @Param("id") id: string) { return this.incidents.ack(id, req.admin.actor); }
  @Post(":id/close") @AdminOnly() close(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.incidents.close(id, parse(z.object({ resolution: z.string().trim().min(3).max(300) }), body).resolution, req.admin.actor);
  }
}
