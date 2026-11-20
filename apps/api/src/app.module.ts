import { Module, OnModuleDestroy, OnModuleInit, Inject, Injectable, Logger } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { BookingsService } from "./bookings.service";
import { CompanyController } from "./company.controller";
import { FlightsService } from "./flights.service";
import { PerformanceService } from "./performance.service";
import { DispatchService } from "./dispatch.service";
import { DriverController } from "./driver.controller";
import { NotificationsService } from "./notifications";
import { HealthController, PartnerController } from "./partner.controller";
import { PrismaService } from "./prisma";
import { QuotesService } from "./quotes.service";
import { RoutingService } from "./routing";
import { AdminGuard, CompanyGuard, DriverGuard, PartnerGuard } from "./security";
import { WebhooksService } from "./webhooks.service";

/** Boucle de fond (expiration des offres, livraison des webhooks). Remplaçable par BullMQ. */
@Injectable()
export class WorkersService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private log = new Logger("workers");
  constructor(
    @Inject(DispatchService) private dispatch: DispatchService,
    @Inject(WebhooksService) private webhooks: WebhooksService,
    @Inject(FlightsService) private flights: FlightsService,
  ) {}
  onModuleInit() {
    if (process.env.DISABLE_WORKERS === "1") return;
    this.timer = setInterval(async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.dispatch.sweep();
        await this.webhooks.deliverDue();
        await this.flights.poll();
      } catch (e: any) {
        this.log.error(e?.message ?? e);
      } finally {
        this.busy = false;
      }
    }, 5000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({
  controllers: [HealthController, PartnerController, DriverController, AdminController, CompanyController, AuthController],
  providers: [PrismaService, QuotesService, BookingsService, DispatchService, WebhooksService, NotificationsService, FlightsService, PerformanceService, RoutingService, AuthService, WorkersService, PartnerGuard, AdminGuard, DriverGuard, CompanyGuard],
})
export class AppModule {}
