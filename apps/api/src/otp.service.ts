import { HttpException, Inject, Injectable } from "@nestjs/common";
import { createHmac, randomInt } from "node:crypto";
import { normalizePhone } from "./phone";
import { PrismaService } from "./prisma";
import { config, safeEqual } from "./security";
import { SmsService } from "./sms";
import { smsSegments } from "./driver-auth";

export const OTP = { ttlMin: 5, maxAttempts: 5, resendSeconds: 30, maxPerWindow: 3, windowMin: 10 };
const ipPerMin = () => Number(process.env.OTP_IP_PER_MIN) || 20;

const hashCode = (phone: string, code: string) => createHmac("sha256", config.tokenSecret).update(`${phone}:${code}`).digest("hex");

@Injectable()
export class OtpService {
  private ipHits = new Map<string, number[]>();
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(SmsService) private sms: SmsService,
  ) {}

  private throttleIp(ip: string, now: number) {
    const recent = (this.ipHits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= ipPerMin()) throw new HttpException("Trop de tentatives, réessayez dans une minute", 429);
    recent.push(now);
    this.ipHits.set(ip, recent);
    if (this.ipHits.size > 10_000) this.ipHits.clear();
  }

  /**
   * Envoie un code. La réponse est identique que le numéro soit connu ou non (pas d'énumération) :
   * on enregistre une demande dans les deux cas, donc les limites s'appliquent uniformément.
   */
  async request(phoneRaw: string, ip: string, now = new Date(), allowActivated = false) {
    const phone = normalizePhone(phoneRaw);
    if (!phone) throw new HttpException({ errors: { phone: ["numéro invalide"] } }, 422);
    this.throttleIp(ip, now.getTime());
    if (!this.sms.provider && !(process.env.DRIVER_DEV_OTP && process.env.NODE_ENV !== "production")) throw new HttpException("Envoi de SMS non configuré", 501);

    const account = await this.prisma.driver.findUnique({where:{phone},select:{id:true,authCredential:{select:{passwordHash:true}}}});
    if(account?.authCredential?.passwordHash && !allowActivated) return {ok:true,resendInSeconds:OTP.resendSeconds};
    const since = new Date(now.getTime() - OTP.windowMin * 60_000);
    const recent = await this.prisma.otpCode.findMany({ where: { phone, createdAt: { gt: since } }, orderBy: { createdAt: "desc" } });
    if (recent.length >= OTP.maxPerWindow) throw new HttpException("Trop de demandes de code, réessayez plus tard", 429);
    if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < OTP.resendSeconds * 1000) throw new HttpException(`Patientez ${OTP.resendSeconds} secondes avant de redemander un code`, 429);

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: now } }), // un nouveau code invalide les précédents
      this.prisma.otpCode.create({ data: { phone, codeHash: hashCode(phone, code), expiresAt: new Date(now.getTime() + OTP.ttlMin * 60_000), createdAt: now } }),
      this.prisma.otpCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86400_000) } } }),
    ]);
    const driver = await this.prisma.driver.findUnique({ where: { phone }, select: { id: true } });
    if (driver && this.sms.provider) {
      const message = `Votre code ${process.env.BRAND_NAME ?? "CliCab"} : ${code}. Valable ${OTP.ttlMin} min. Ne le communiquez à personne.`;
      const provider=process.env.SMS_PROVIDER??"console";
      const usage=await this.prisma.driverOtpUsage.create({data:{provider,segments:smsSegments(message)}});
      await this.sms.provider.send(phone,message);
      await this.prisma.driverOtpUsage.update({where:{id:usage.id},data:{status:"ACCEPTED"}});
    }
    return { ok: true, resendInSeconds: OTP.resendSeconds };
  }

  /** Vérifie le code ; retourne l'identifiant du chauffeur. Échec générique : 401 « Identifiants invalides ». */
  async verify(phoneRaw: string, code: string, ip: string, now = new Date()): Promise<string> {
    const phone = normalizePhone(phoneRaw);
    const fail = () => new HttpException("Identifiants invalides", 401);
    if (!phone) throw fail();
    this.throttleIp(ip, now.getTime());
    const driver = await this.prisma.driver.findUnique({ where: { phone }, select: { id: true } });

    // Code de développement : jamais en production (refusé aussi au démarrage), uniquement s'il est défini explicitement.
    const dev = process.env.DRIVER_DEV_OTP;
    if (dev && process.env.NODE_ENV !== "production" && driver && safeEqual(code, dev)) return driver.id;

    const otp = await this.prisma.otpCode.findFirst({ where: { phone, consumedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
    if (!otp || !driver || otp.attempts >= OTP.maxAttempts) throw fail();
    if (!safeEqual(hashCode(phone, code.trim()), otp.codeHash)) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw fail();
    }
    // Consommation atomique : deux requêtes simultanées avec le même code ne passent pas toutes les deux.
    const used = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: now } });
    if (used.count !== 1) throw fail();
    return driver.id;
  }
}
