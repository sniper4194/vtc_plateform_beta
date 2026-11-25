import {Body,Controller,Get,HttpException,Inject,Param,Post,Query,Req,UseGuards} from "@nestjs/common";
import {PrismaService} from "./prisma";
import {DriverAuthService} from "./driver-auth.service";
import {AdminGuard,AdminOnly,DriverGuard} from "./security";
import {activateSchema,adminSchema,challengeSchema,loginSchema} from "./driver-auth";
import {parse} from "./http";
@Controller("driver/auth")
export class DriverAuthController{
 constructor(@Inject(DriverAuthService) private auth:DriverAuthService,@Inject(PrismaService) private db:PrismaService){}
 @Post("activate") activate(@Req() r:any,@Body() b:unknown){const x=parse(activateSchema,b);return this.auth.activate(x.phone,x.code,x.password,r.ip??"unknown");}
 @Post("password") login(@Req() r:any,@Body() b:unknown){const x=parse(loginSchema,b);return this.auth.login(x.phone,x.password,r.ip??"unknown",x.deviceKey,x.code);}
 @Post("device-code") request(@Req() r:any,@Body() b:unknown){const x=parse(challengeSchema,b);return this.auth.requestDevice(x.phone,x.password,r.ip??"unknown");}
 @Get("session") @UseGuards(DriverGuard) session(){return {ok:true};}
 @Post("logout") @UseGuards(DriverGuard) async logout(@Req() r:any){if(r.driverSessionId)await this.db.driverSession.updateMany({where:{id:r.driverSessionId,driverId:r.driverId},data:{revokedAt:new Date()}});return {ok:true};}
}
@Controller("admin/driver-auth")
@UseGuards(AdminGuard)
@AdminOnly()
export class AdminDriverAuthController{
 constructor(@Inject(DriverAuthService) private auth:DriverAuthService,@Inject(PrismaService) private db:PrismaService){}
 @Get("costs") async costs(@Query("days") raw:string){
  const days=raw==="90"?90:30;const from=new Date(Date.now()-days*86400_000);
  const rows=await this.db.driverOtpUsage.groupBy({by:["provider","status"],where:{createdAt:{gte:from}},_count:{_all:true},_sum:{segments:true}});
  return {days,from,rows:rows.map(x=>({provider:x.provider,status:x.status,count:x._count._all,segments:x._sum.segments??0}))};
 }
 @Get(":id") async detail(@Param("id") id:string){
  const d=await this.db.driver.findUnique({where:{id},select:{id:true,authCredential:{select:{passwordHash:true}},authDevices:{where:{revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true,createdAt:true,expiresAt:true}},authSessions:{where:{revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true,createdAt:true,expiresAt:true}}}});
  if(!d)throw new HttpException("Chauffeur introuvable",404);
  return {activated:!!d.authCredential?.passwordHash,devices:d.authDevices,sessions:d.authSessions};
 }
 @Post(":id/revoke") revoke(@Req() r:any,@Param("id") id:string,@Body() b:unknown){if(!r.admin.id)throw new HttpException("Compte nominatif requis",403);const x=parse(adminSchema,b);return this.auth.revoke(id,r.admin.actor,x.reason,false);}
 @Post(":id/reset") reset(@Req() r:any,@Param("id") id:string,@Body() b:unknown){if(!r.admin.id)throw new HttpException("Compte nominatif requis",403);const x=parse(adminSchema,b);return this.auth.revoke(id,r.admin.actor,x.reason,true);}
}
