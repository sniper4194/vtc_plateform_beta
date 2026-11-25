import { Controller, Get, Inject, Query, Req, Res, UseGuards } from "@nestjs/common";
import { earningsCsv } from "./earnings";
import { EarningsService } from "./earnings.service";
import { DriverGuard } from "./security";

@Controller("driver/earnings")
@UseGuards(DriverGuard)
export class EarningsController {
  constructor(@Inject(EarningsService) private earnings: EarningsService) {}

  /** Revenus d'une période (day, week, fortnight, month) ou d'un intervalle `from`–`to`. */
  @Get()
  async get(@Req() req: any, @Query() q: Record<string, string>) {
    const b = this.earnings.bounds(q.period, q.from, q.to);
    return { period: b.period, from: b.from, to: b.to, ...(await this.earnings.compute(req.driverId, b.from, b.to)) };
  }

  /** Export pour le comptable (CSV, séparateur « ; »). */
  @Get("csv")
  async csv(@Req() req: any, @Res() res: any, @Query() q: Record<string, string>) {
    const b = this.earnings.bounds(q.period, q.from, q.to);
    const e = await this.earnings.compute(req.driverId, b.from, b.to);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="mes-revenus.csv"');
    res.send("﻿" + earningsCsv(e));
  }
}
