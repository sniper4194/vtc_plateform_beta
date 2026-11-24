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
import { EmailService } from "./email";
import { NotificationsService } from "./notifications";
import { OtpService } from "./otp.service";
import { SmsService } from "./sms";
import { HealthController, PartnerController } from "./partner.controller";
import { PrismaService } from "./prisma";
import { QuotesService } from "./quotes.service";
import { AdminRescueController, RescueController } from "./rescue.controller";
import { PenaltiesService } from "./penalties.service";
import { TrackingController } from "./tracking.controller";
import { IdentityService } from "./identity.service";
import { DeadlinesService } from "./deadlines.service";
import { EarningsController } from "./earnings.controller";
import { EarningsService } from "./earnings.service";
import { AdminIncidentController, IncidentController } from "./incident.controller";
import { IncidentService } from "./incident.service";
import { RescueService } from "./rescue.service";
import { ApplyController, AdminRecruitmentController, DriverReferralController } from "./recruitment.controller";
import { RecruitmentService } from "./recruitment.service";
import { AdminProofController, DriverProofController, PartnerProofController } from "./proof.controller";
import { ProofService } from "./proof.service";
import { APP_FILTER } from "@nestjs/core";
import { AllExceptionsFilter, ErrorReporter } from "./errors";
import { ClientErrorController } from "./client-errors.controller";
import { AdminReliabilityController, PartnerReliabilityController, ReliabilityService } from "./reliability";
import { DriverSwapController, SwapService } from "./swap";
import { AdminCarbonController, CarbonService, PartnerCarbonController } from "./carbon";
import { AdminLostItemController, DriverLostItemController, LostItemService, TrackLostItemController } from "./lost-items";
import { AdminMeetingPointController, DriverMeetingPointController, MeetingPointService } from "./meeting-points";
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
    @Inject(RescueService) private rescue: RescueService,
    @Inject(IdentityService) private identity: IdentityService,
    @Inject(DeadlinesService) private deadlines: DeadlinesService,
    @Inject(RecruitmentService) private recruitment: RecruitmentService,
    @Inject(ErrorReporter) private reporter: ErrorReporter,
  ) {}
  onModuleInit() {
    if (process.env.DISABLE_WORKERS === "1") return;
    this.timer = setInterval(async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.dispatch.sweep();
        await this.rescue.sweep();
        await this.identity.sweep();
        await this.identity.spotSweep();
        await this.identity.expireSpots();
        await this.deadlines.sweep();
        await this.recruitment.sweep();
        await this.webhooks.deliverDue();
        await this.flights.poll();
      } catch (e: any) {
        this.log.error(e?.message ?? e);
        void this.reporter.report({ source: "tâches de fond", message: e?.message ?? String(e), stack: e?.stack });
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
  // Ordre : les routes de preuves (driver/rides/:id/proofs) passent avant la route générique des actions de mission (driver/rides/:id/:action).
  controllers: [HealthController, PartnerCarbonController, AdminCarbonController, DriverSwapController, TrackLostItemController, DriverLostItemController, AdminLostItemController, PartnerProofController, PartnerReliabilityController, DriverProofController, PartnerController, DriverController, AdminController, AdminRescueController, RescueController, EarningsController, IncidentController, AdminIncidentController, CompanyController, TrackingController, AuthController, ApplyController, AdminRecruitmentController, DriverReferralController, AdminProofController, ClientErrorController, DriverMeetingPointController, AdminMeetingPointController, AdminReliabilityController],
  providers: [PrismaService, QuotesService, BookingsService, DispatchService, RescueService, PenaltiesService, IdentityService, DeadlinesService, EarningsService, IncidentService, RecruitmentService, ProofService, MeetingPointService, ReliabilityService, SwapService, LostItemService, CarbonService, ErrorReporter, { provide: APP_FILTER, useClass: AllExceptionsFilter }, WebhooksService, NotificationsService, EmailService, FlightsService, PerformanceService, RoutingService, AuthService, OtpService, SmsService, WorkersService, PartnerGuard, AdminGuard, DriverGuard, CompanyGuard],
})
export class AppModule {}
