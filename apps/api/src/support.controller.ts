import {Body,Controller,Get,HttpException,Inject,Param,Post,Query,Req,UseGuards} from "@nestjs/common";
import {Prisma} from "@prisma/client";
import {PrismaService} from "./prisma";
import {AdminGuard,AdminOnly} from "./security";
import {parse} from "./http";
import {ticketSchema,querySchema,assignSchema,noteSchema,transitionSchema,moneySchema,decisionSchema,ratingSchema,deadlines,canTransition} from "./support";
const relations={ride:{select:{ref:true,status:true}},driver:{select:{id:true,firstName:true,lastName:true}},partner:{select:{id:true,name:true}},account:{select:{id:true,name:true}},assignee:{select:{id:true,name:true}},incident:{select:{id:true,kind:true}},money:true} as const;
@Controller("admin/support")
@UseGuards(AdminGuard)
@AdminOnly()
export class SupportController {
 constructor(@Inject(PrismaService) private db:PrismaService){}
 @Get()
 async list(@Query() raw:unknown){
 const q=parse(querySchema,raw),now=new Date();
 const active:Prisma.SupportTicketWhereInput={status:{in:["OPEN","IN_PROGRESS","WAITING"]}};
 const late:Prisma.SupportTicketWhereInput={AND:[active,{OR:[{firstResponseAt:null,firstResponseDueAt:{lt:now}},{resolutionDueAt:{lt:now}}]}]};
 const n=/^(?:SAV-)?(\d+)$/i.exec(q.q);
 const where:Prisma.SupportTicketWhereInput={AND:[q.status?{status:q.status}:{},q.priority?{priority:q.priority}:{},q.overdue==="1"?late:{},q.q?{OR:[{title:{contains:q.q,mode:"insensitive"}},...(n&&Number(n[1])<=2147483647?[{ref:Number(n[1])}]:[])]}:{}]};
 const [items,total,counts,overdue,urgent,satisfaction]=await Promise.all([
 this.db.supportTicket.findMany({where,include:relations,orderBy:[{createdAt:"desc"},{id:"asc"}],skip:(q.page-1)*50,take:50}),this.db.supportTicket.count({where}),this.db.supportTicket.groupBy({by:["status"],_count:{_all:true}}),this.db.supportTicket.count({where:late}),this.db.supportTicket.count({where:{AND:[active,{priority:"URGENT"}]}}),this.db.supportTicket.aggregate({_avg:{satisfaction:true},_count:{satisfaction:true}})]);
 return {items,total,counts,overdue,urgent,satisfaction:satisfaction._avg.satisfaction,rated:satisfaction._count.satisfaction};
 }
 @Get("team")
 team(){return this.db.adminUser.findMany({where:{active:true,role:"ADMIN"},select:{id:true,name:true},orderBy:{name:"asc"}});}
 @Get("lookup")
 async lookup(@Query("kind") kind:string,@Query("q") raw:string){
 const q=(raw??"").trim().slice(0,100);if(!q)return [];
 if(kind==="driver")return (await this.db.driver.findMany({where:{OR:[{firstName:{contains:q,mode:"insensitive"}},{lastName:{contains:q,mode:"insensitive"}}]},select:{id:true,firstName:true,lastName:true},take:20})).map(x=>({id:x.id,label:x.firstName+" "+x.lastName}));
 if(kind==="partner")return (await this.db.partner.findMany({where:{name:{contains:q,mode:"insensitive"}},select:{id:true,name:true},take:20})).map(x=>({id:x.id,label:x.name}));
 if(kind==="account")return (await this.db.crmAccount.findMany({where:{name:{contains:q,mode:"insensitive"}},select:{id:true,name:true},take:20})).map(x=>({id:x.id,label:x.name}));
 if(kind==="incident")return (await this.db.incident.findMany({where:{id:{startsWith:q}},select:{id:true,kind:true},take:20})).map(x=>({id:x.id,label:x.kind+" · "+x.id}));
 throw new HttpException("Type de recherche inconnu",422);
 }
 @Get(":id")
 async detail(@Param("id") id:string){const t=await this.db.supportTicket.findUnique({where:{id},include:{...relations,events:{orderBy:{createdAt:"desc"},take:200}}});if(!t)throw new HttpException("Ticket introuvable",404);return t;}
 @Post()
 async create(@Req() req:any,@Body() raw:unknown){
 const {rideRef,...data}=parse(ticketSchema,raw);
 return this.db.$transaction(async tx=>{
 const incident=data.incidentId?await tx.incident.findUnique({where:{id:data.incidentId}}):null;
 if(data.incidentId&&!incident)throw new HttpException("Incident introuvable",404);
 const ride=rideRef?await tx.ride.findUnique({where:{ref:rideRef},include:{booking:{select:{partnerId:true}}}}):incident?.rideId?await tx.ride.findUnique({where:{id:incident.rideId},include:{booking:{select:{partnerId:true}}}}):null;
 if((rideRef||incident?.rideId)&&!ride)throw new HttpException("Course introuvable",404);
 if(incident?.rideId&&ride?.id!==incident.rideId)throw new HttpException("Incident et course incompatibles",422);
 const driverId=incident?.driverId??ride?.driverId??data.driverId;
 const partnerId=ride?ride.booking.partnerId??undefined:data.partnerId;
 if(data.driverId&&driverId!==data.driverId||data.partnerId&&partnerId!==data.partnerId)throw new HttpException("Liens incompatibles",422);
 if(driverId&&!await tx.driver.findUnique({where:{id:driverId},select:{id:true}}))throw new HttpException("Chauffeur introuvable",404);
 if(partnerId&&!await tx.partner.findUnique({where:{id:partnerId},select:{id:true}}))throw new HttpException("Partenaire introuvable",404);
 if(data.accountId){const a=await tx.crmAccount.findUnique({where:{id:data.accountId}});if(!a||partnerId&&a.partnerId!==partnerId)throw new HttpException("Fiche CRM incompatible",422);}
 if(data.assigneeId&&!await tx.adminUser.findFirst({where:{id:data.assigneeId,active:true,role:"ADMIN"}}))throw new HttpException("Administrateur indisponible",422);
 const t=await tx.supportTicket.create({data:{...data,driverId,partnerId,rideId:ride?.id,...deadlines(data.priority,new Date())}});
 await tx.supportEvent.create({data:{ticketId:t.id,kind:"CREATED",note:"Dossier créé",actor:req.admin.actor}});
 await tx.auditLog.create({data:{entity:"SupportTicket",entityId:t.id,action:"support.created",actor:req.admin.actor}});return t;
 });
 }
 private async mutate(id:string,version:number,actor:string,kind:string,note:string,fn:(tx:Prisma.TransactionClient,t:Prisma.SupportTicketGetPayload<{include:{money:true}}>)=>Promise<Prisma.SupportTicketUncheckedUpdateManyInput>){
 return this.db.$transaction(async tx=>{
 const t=await tx.supportTicket.findUnique({where:{id},include:{money:true}});
 if(!t)throw new HttpException("Ticket introuvable",404);
 if(t.version!==version)throw new HttpException("Ticket modifié, actualisez",409);
 const lock=await tx.supportTicket.updateMany({where:{id,version},data:{version:{increment:1}}});
 if(!lock.count)throw new HttpException("Ticket modifié, actualisez",409);
 const data=await fn(tx,t);await tx.supportTicket.updateMany({where:{id},data});
 await tx.supportEvent.create({data:{ticketId:id,kind,note,actor}});
 await tx.auditLog.create({data:{entity:"SupportTicket",entityId:id,action:"support."+kind.toLowerCase(),actor}});return {ok:true};
 });
 }
 @Post(":id/assign")
 assign(@Req() req:any,@Param("id") id:string,@Body() raw:unknown){const x=parse(assignSchema,raw);return this.mutate(id,x.version,req.admin.actor,"ASSIGNED","Attribution modifiée",async(tx,t)=>{if(t.status==="CLOSED")throw new HttpException("Dossier clos",409);if(x.assigneeId&&!await tx.adminUser.findFirst({where:{id:x.assigneeId,role:"ADMIN",active:true}}))throw new HttpException("Administrateur indisponible",422);return {assigneeId:x.assigneeId} as Prisma.SupportTicketUncheckedUpdateManyInput;});}
 @Post(":id/note")
 note(@Req() req:any,@Param("id") id:string,@Body() raw:unknown){const x=parse(noteSchema,raw);return this.mutate(id,x.version,req.admin.actor,"NOTE",x.note,async()=>({}));}
 @Post(":id/status")
 status(@Req() req:any,@Param("id") id:string,@Body() raw:unknown){const x=parse(transitionSchema,raw);return this.mutate(id,x.version,req.admin.actor,"STATUS",x.status+" : "+x.note,async(_tx,t)=>{
 if(!canTransition(t.status,x.status)||(["RESOLVED","CLOSED"].includes(x.status)&&t.money?.status==="PENDING"))throw new HttpException("Transition impossible ou décision financière en attente",409);
 return {status:x.status,...(!t.firstResponseAt&&x.status==="IN_PROGRESS"?{firstResponseAt:new Date()}:{}),...(x.status==="RESOLVED"?{resolvedAt:new Date(),resolution:x.note}:{}),...(x.status==="CLOSED"?{closedAt:new Date()}: {})};
 });}
 @Post(":id/money")
 money(@Req() req:any,@Param("id") id:string,@Body() raw:unknown){const x=parse(moneySchema,raw);if(!req.admin.id)throw new HttpException("Compte nominatif requis",403);return this.mutate(id,x.version,req.admin.actor,"MONEY_REQUEST",x.reason,async(tx,t)=>{if(t.money||["RESOLVED","CLOSED"].includes(t.status))throw new HttpException("Demande existante ou dossier terminé",409);await tx.supportMoney.create({data:{ticketId:id,kind:x.kind,amountCents:x.amountCents,reason:x.reason,requestedBy:req.admin.id}});return {};});}
 @Post(":id/money/decision")
 decide(@Req() req:any,@Param("id") id:string,@Body() raw:unknown){const x=parse(decisionSchema,raw);if(!req.admin.id)throw new HttpException("Compte nominatif requis",403);return this.mutate(id,x.version,req.admin.actor,"MONEY_"+x.decision,x.reason,async(tx,t)=>{if(!t.money||t.money.status!=="PENDING"||t.money.requestedBy===req.admin.id)throw new HttpException("Décision par un autre administrateur requise",403);await tx.supportMoney.update({where:{id:t.money.id},data:{status:x.decision,decidedBy:req.admin.id,decidedAt:new Date(),decisionReason:x.reason}});return {};});}
 @Post(":id/rating")
 rating(@Req() req:any,@Param("id") id:string,@Body() raw:unknown){const x=parse(ratingSchema,raw);return this.mutate(id,x.version,req.admin.actor,"RATING",x.note,async(_tx,t)=>{if(!["RESOLVED","CLOSED"].includes(t.status)||t.satisfaction!==null)throw new HttpException("Évaluation non disponible ou déjà saisie",409);return {satisfaction:x.score};});}
}
