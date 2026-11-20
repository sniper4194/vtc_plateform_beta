import { Module, OnModuleDestroy, OnModuleInit, Inject, Injectable, Logger } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { BookingsService } from "./bookings.service";
import { DispatchService } from "./dispatch.service";
import { DriverController } from "./driver.controller";
import { NotificationsService } from "./notifications";
import { HealthController, PartnerController } from "./partner.controller";
import { PrismaService } from "./prisma";
import { QuotesService } from "./quotes.service";
import { AdminGuard, DriverGuard, PartnerGuard } from "./security";
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
  ) {}
  onModuleInit() {
    if (process.env.DISABLE_WORKERS === "1") return;
    this.timer = setInterval(async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.dispatch.sweep();
        await this.webhooks.deliverDue();
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
  controllers: [HealthController, PartnerController, DriverController, AdminController],
  providers: [PrismaService, QuotesService, BookingsService, DispatchService, WebhooksService, NotificationsService, WorkersService, PartnerGuard, AdminGuard, DriverGuard],
})
export class AppModule {}
