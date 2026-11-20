import { Body, Controller, Get, HttpException, Delete, Headers, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { BookingRequestSchema, QuoteRequestSchema } from "@vtc/shared";
import { BookingsService } from "./bookings.service";
import { parse } from "./http";
import { RatingSchema } from "./schemas";
import { QuotesService } from "./quotes.service";
import { PartnerGuard } from "./security";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok" };
  }
}

@Controller("v1")
@UseGuards(PartnerGuard)
export class PartnerController {
  constructor(
    @Inject(QuotesService) private quotes: QuotesService,
    @Inject(BookingsService) private bookings: BookingsService,
  ) {}

  @Post("quotes")
  quote(@Req() req: any, @Body() body: unknown) {
    return this.quotes.create(req.partner, parse(QuoteRequestSchema, body));
  }

  @Post("bookings")
  async book(@Req() req: any, @Res({ passthrough: true }) res: any, @Headers("idempotency-key") key: string | undefined, @Body() body: unknown) {
    if (!key || key.length > 100) throw new HttpException("En-tête Idempotency-Key requis (≤ 100 caractères)", 400);
    const r = await this.bookings.create(req.partner, key, parse(BookingRequestSchema, body), req.sandbox);
    res.status(r.created ? 201 : 200);
    return r.booking;
  }

  @Get("bookings/:id")
  get(@Req() req: any, @Param("id") id: string) {
    return this.bookings.get(req.partner, id);
  }

  /** Note du trajet par le voyageur (via le partenaire), 1 à 5 ; uniquement après la course. */
  @Post("bookings/:id/rating")
  rate(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(RatingSchema, body);
    return this.bookings.rate(req.partner, id, b.score, b.comment);
  }

  @Delete("bookings/:id")
  cancel(@Req() req: any, @Param("id") id: string) {
    return this.bookings.cancel(req.partner, id);
  }
}
