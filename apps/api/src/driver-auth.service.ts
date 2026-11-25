import {HttpException,Inject,Injectable} from "@nestjs/common";
import {randomBytes} from "node:crypto";
import {Prisma} from "@prisma/client";
import {PrismaService} from "./prisma";
import {OtpService} from "./otp.service";
import {normalizePhone} from "./phone";
import {config,sha256,signToken} from "./security";
import {hashDriverPassword,verifyDriverPassword,SESSION_SECONDS,DEVICE_MS} from "./driver-auth";
const invalid=()=>new HttpException("Identifiants invalides",401);
@Injectable()
export class DriverAuthService {
 private hits=new Map<string,number[]>();
 private busy=0;
 private dummy:string|null=null;
 constructor(@Inject(PrismaService) private db:PrismaService,@Inject(OtpService) private otp:OtpService){}
 private limit(ip:string){
  const now=Date.now(),v=(this.hits.get(ip)||[]).filter(t=>t>now-60000);
  if(v.length>=12||this.busy>=4)throw new HttpException("Trop de tentatives, réessayez plus tard",429);
  v.push(now);this.hits.set(ip,v);if(this.hits.size>10000){for(const [k,a] of this.hits)if(a[a.length-1]<now-60000)this.hits.delete(k);}
 }
 private async expensive<T>(fn:()=>Promise<T>){if(this.busy>=4)throw new HttpException("Réessayez plus tard",429);this.busy++;try{return await fn();}finally{this.busy--;}}
 private async issue(tx:Prisma.TransactionClient,driverId:string,version:number,deviceId:string|null,seconds:number){
  const session=await tx.driverSession.create({data:{driverId,credentialVersion:version,deviceId,expiresAt:new Date(Date.now()+seconds*1000)}});
  return {token:signToken({sub:driverId,role:"driver",sid:session.id},config.tokenSecret,seconds),driverId};
 }
 private async registerDevice(tx:Prisma.TransactionClient,driverId:string,version:number){
  const key=randomBytes(32).toString("hex");
  const d=await tx.driverDevice.create({data:{driverId,secretHash:sha256(key),expiresAt:new Date(Date.now()+DEVICE_MS)}});
  return {...await this.issue(tx,driverId,version,d.id,SESSION_SECONDS),deviceKey:key};
 }
 async legacyLogin(phone:string,code:string,ip:string){
  const id=await this.otp.verify(phone,code,ip);
  return this.db.$transaction(async tx=>{
   if(await tx.driverCredential.findUnique({where:{driverId:id}}))throw new HttpException("Compte activé : utilisez la connexion sécurisée de la nouvelle application",403);
   return this.issue(tx,id,0,null,12*3600);
  });
 }
 async activate(phoneRaw:string,code:string,password:string,ip:string){
  this.limit(ip);const phone=normalizePhone(phoneRaw);if(!phone)throw invalid();
  const driver=await this.db.driver.findUnique({where:{phone},select:{id:true,authCredential:true}});
  if(!driver||driver.authCredential?.passwordHash)throw invalid();
  if(password.includes(phone.slice(-9))||password.toLowerCase().includes("clicab"))throw new HttpException("Choisissez une phrase secrète différente du numéro et de CliCab",422);
  const hash=await this.expensive(()=>hashDriverPassword(password));
  const id=await this.otp.verify(phone,code,ip);if(id!==driver.id)throw invalid();
  return this.db.$transaction(async tx=>{
   let version=1;
   if(driver.authCredential){
    const old=driver.authCredential;version=old.version+1;
    const change=await tx.driverCredential.updateMany({where:{driverId:id,version:old.version,passwordHash:null},data:{passwordHash:hash,version,failed:0,lockedUntil:null}});
    if(!change.count)throw invalid();
   }else{
    try{await tx.driverCredential.create({data:{driverId:id,passwordHash:hash,version}});}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==="P2002")throw invalid();throw e;}
   }
   await tx.driverSession.updateMany({where:{driverId:id,revokedAt:null},data:{revokedAt:new Date()}});
   await tx.driverDevice.updateMany({where:{driverId:id,revokedAt:null},data:{revokedAt:new Date()}});
   await tx.auditLog.create({data:{actor:"driver:"+id,entity:"Driver",entityId:id,action:"driver.auth_activated"}});
   return this.registerDevice(tx,id,version);
  });
 }
 private async checked(phoneRaw:string,password:string,ip:string){
  this.limit(ip);const phone=normalizePhone(phoneRaw);
  const d=phone?await this.db.driver.findUnique({where:{phone},select:{id:true,authCredential:true}}):null;
  const a=d?.authCredential;
  if(a?.lockedUntil&&a.lockedUntil>new Date())throw invalid();
  const ok=await this.expensive(async()=>{if(!this.dummy)this.dummy=await hashDriverPassword(randomBytes(32).toString("hex"));return verifyDriverPassword(password,a?.passwordHash??this.dummy);});
  if(!d||!a?.passwordHash||!ok){
   if(d&&a?.passwordHash)await this.db.$transaction(async tx=>{
    const x=await tx.driverCredential.updateMany({where:{driverId:d.id,version:a.version},data:{failed:{increment:1}}});
    if(x.count)await tx.driverCredential.updateMany({where:{driverId:d.id,version:a.version,failed:{gte:5}},data:{lockedUntil:new Date(Date.now()+15*60000)}});
   });
   throw invalid();
  }
  const reset=await this.db.driverCredential.updateMany({where:{driverId:d.id,version:a.version,OR:[{lockedUntil:null},{lockedUntil:{lte:new Date()}}]},data:{failed:0,lockedUntil:null}});
  if(!reset.count)throw invalid();
  return {id:d.id,phone:phone!,version:a.version};
 }
 async requestDevice(phone:string,password:string,ip:string){const d=await this.checked(phone,password,ip);return this.otp.request(d.phone,ip,new Date(),true);}
 async login(phone:string,password:string,ip:string,key?:string,code?:string){
  const d=await this.checked(phone,password,ip);
  const trusted=key?await this.db.driverDevice.findFirst({where:{driverId:d.id,secretHash:sha256(key),revokedAt:null,expiresAt:{gt:new Date()}}}):null;
  if(!trusted&&!code)return {requiresSms:true as const};
  if(!trusted&&await this.otp.verify(d.phone,code!,ip)!==d.id)throw invalid();
  return this.db.$transaction(async tx=>{
   const a=await tx.driverCredential.findUnique({where:{driverId:d.id}});
   if(!a?.passwordHash||a.version!==d.version)throw invalid();
   if(trusted){
    const device=await tx.driverDevice.findFirst({where:{id:trusted.id,revokedAt:null,expiresAt:{gt:new Date()}}});
    if(!device)throw invalid();
    return this.issue(tx,d.id,d.version,device.id,SESSION_SECONDS);
   }
   return this.registerDevice(tx,d.id,d.version);
  });
 }
 async revoke(id:string,actor:string,reason:string,resetPassword:boolean){
  return this.db.$transaction(async tx=>{
   const d=await tx.driver.findUnique({where:{id},select:{id:true,phone:true}});if(!d)throw new HttpException("Chauffeur introuvable",404);
   await tx.driverCredential.upsert({where:{driverId:id},create:{driverId:id},update:{version:{increment:1},...(resetPassword?{passwordHash:null}:{}),failed:0,lockedUntil:null}});
   await tx.driverSession.updateMany({where:{driverId:id,revokedAt:null},data:{revokedAt:new Date()}});
   await tx.driverDevice.updateMany({where:{driverId:id,revokedAt:null},data:{revokedAt:new Date()}});
   await tx.otpCode.updateMany({where:{phone:d.phone,consumedAt:null},data:{consumedAt:new Date()}});
   await tx.auditLog.create({data:{actor,entity:"Driver",entityId:id,action:resetPassword?"driver.auth_reset":"driver.auth_revoke",data:{reason}}});
   return {ok:true};
  });
 }
}
