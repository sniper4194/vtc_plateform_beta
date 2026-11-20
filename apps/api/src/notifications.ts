import { Injectable, Logger } from "@nestjs/common";

/** Stub : remplacé en phase 2 par FCM/APNs (push), Twilio (SMS/WhatsApp). */
@Injectable()
export class NotificationsService {
  private log = new Logger("notifications");
  sent: { driverId: string; message: string }[] = [];
  notifyDriver(driverId: string, message: string) {
    this.sent.push({ driverId, message });
    if (this.sent.length > 500) this.sent.shift();
    this.log.log(`→ chauffeur ${driverId} : ${message}`);
  }
}
