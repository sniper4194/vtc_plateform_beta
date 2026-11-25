import {INestApplication} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {PrismaClient} from "@prisma/client";
import {AddressInfo} from "node:net";
import {beforeAll,afterAll,it,expect} from "vitest";
import {AppModule} from "./app.module";
import {config,signToken} from "./security";
import {SmsService} from "./sms";
const db=new PrismaClient();let app:INestApplication,base:string;
const phone="+33699999001",password="Une longue phrase personnelle";
async function call(path:string,body?:unknown,token?:string){const r=await fetch(base+path,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,json:await r.json()};}
beforeAll(async()=>{app=await NestFactory.create(AppModule,{logger:false});await app.listen(0);base="http://127.0.0.1:"+(app.getHttpServer().address() as AddressInfo).port;});
afterAll(async()=>{await app.close();await db.$disconnect();});
it("migration sans perte de compte, appareil connu, SMS exceptionnel, révocation et récupération",async()=>{
 const d=await db.driver.create({data:{phone,email:"hybrid-test@example.test",firstName:"Test",lastName:"Hybrid"}});
 const admin=await db.adminUser.create({data:{email:"hybrid-admin@example.test",name:"Admin test",passwordHash:"unused",role:"ADMIN"}});
 const adminToken=signToken({sub:admin.id,role:"admin",tv:admin.tokenVersion},config.tokenSecret,3600);
 const legacy=await call("/driver/login",{phone,code:"000000"});expect(legacy.status).toBe(201);
 expect((await call("/driver/auth/session",undefined,legacy.json.token)).status).toBe(200);
 const activated=await call("/driver/auth/activate",{phone,code:"000000",password});expect(activated.status).toBe(201);expect(activated.json.deviceKey).toHaveLength(64);
 expect((await call("/driver/auth/session",undefined,legacy.json.token)).status).toBe(401);
 expect((await call("/driver/login",{phone,code:"000000"})).status).toBe(403);
 const trusted=await call("/driver/auth/password",{phone,password,deviceKey:activated.json.deviceKey});expect(trusted.status).toBe(201);expect(trusted.json.token).toBeTruthy();
 expect((await call("/driver/auth/password",{phone,password})).json.requiresSms).toBe(true);
 expect((await call("/driver/auth/password",{phone,password:"incorrect"})).status).toBe(401);
 const sms=app.get(SmsService),old=sms.provider;let sent=0;sms.provider={send:async()=>{sent++;}};
 try{
  await call("/driver/otp",{phone});expect(sent).toBe(0);
  const request=await call("/driver/auth/device-code",{phone,password});expect(request.status).toBe(201);expect(sent).toBe(1);
  const fresh=await call("/driver/auth/password",{phone,password,code:"000000"});expect(fresh.status).toBe(201);
  expect((await call("/driver/auth/logout",{},fresh.json.token)).status).toBe(201);
  expect((await call("/driver/auth/session",undefined,fresh.json.token)).status).toBe(401);
  expect((await call("/admin/driver-auth/"+d.id+"/revoke",{reason:"Téléphone perdu signalé",verified:true},adminToken)).status).toBe(201);
  expect((await call("/driver/auth/session",undefined,trusted.json.token)).status).toBe(401);
  expect((await call("/driver/auth/password",{phone,password,deviceKey:activated.json.deviceKey})).json.requiresSms).toBe(true);
  expect((await call("/admin/driver-auth/"+d.id+"/reset",{reason:"Identité vérifiée par équipe",verified:true},adminToken)).status).toBe(201);
  expect((await call("/driver/auth/password",{phone,password})).status).toBe(401);
  expect((await call("/driver/auth/activate",{phone,code:"000000",password:"Nouvelle longue phrase personnelle"})).status).toBe(201);
  expect(await db.driver.count({where:{id:d.id}})).toBe(1);
 }finally{sms.provider=old;await db.driver.delete({where:{id:d.id}});await db.adminUser.delete({where:{id:admin.id}});}
});
