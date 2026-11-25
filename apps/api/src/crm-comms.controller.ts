import { Body, Controller, Get, HttpException, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "./prisma";
import { AdminGuard, AdminOnly } from "./security";
import { EmailService } from "./email";
import { parse } from "./http";
import { todayParis } from "./crm-deals";
import { appointmentSchema, draftSchema, emailAddress, permissionSchema, quoteText, renderTemplate, sendSchema, templateSchema } from "./crm-comms";

@Controller("admin/crm")
@UseGuards(AdminGuard)
@AdminOnly()
export class CrmCommsController {
  constructor(@Inject(PrismaService) private prisma:PrismaService,@Inject(EmailService) private email:EmailService){}
  private enabled(){return process.env.CRM_EMAIL_ENABLED==="1" && process.env.EMAIL_PROVIDER==="resend" && !!this.email.provider;}
  private async account(id:string){
    const a=await this.prisma.crmAccount.findUnique({where:{id}});
    if(!a)throw new HttpException("Fiche introuvable",404);
    return a;
  }
  @Get("communications/templates")
  templates(){return this.prisma.crmEmailTemplate.findMany({orderBy:{createdAt:"desc"},take:100});}
  @Post("communications/templates")
  template(@Body() raw:unknown){return this.prisma.crmEmailTemplate.create({data:parse(templateSchema,raw)});}
  @Get("communications/agenda")
  async agenda(){
    const horizon=new Date(Date.now()+60*86400_000);
    const [appointments, followUps, renewals]=await Promise.all([
      this.prisma.crmAppointment.findMany({where:{doneAt:null,startsAt:{lte:horizon}},include:{account:{select:{id:true,name:true}}},orderBy:{startsAt:"asc"},take:200}),
      this.prisma.crmAccount.findMany({where:{stage:{not:"LOST"},nextActionAt:{lte:horizon}},select:{id:true,name:true,nextAction:true,nextActionAt:true},orderBy:{nextActionAt:"asc"},take:200}),
      this.prisma.crmDeal.findMany({where:{status:"SIGNED",renewalOn:{lte:horizon}},select:{id:true,contractRef:true,renewalOn:true,endsOn:true,account:{select:{id:true,name:true}}},orderBy:{renewalOn:"asc"},take:200}),
    ]);
    return {appointments,followUps,renewals};
  }
  @Get(":accountId/communications")
  async list(@Param("accountId") id:string){
    const a=await this.account(id), address=emailAddress.safeParse(a.email);
    const [permission,mails,appointments,deals]=await Promise.all([
      address.success?this.prisma.crmEmailPermission.findUnique({where:{email:address.data}}):null,
      this.prisma.crmMail.findMany({where:{accountId:id},orderBy:{createdAt:"desc"},take:100}),
      this.prisma.crmAppointment.findMany({where:{accountId:id},orderBy:{startsAt:"desc"},take:100}),
      this.prisma.crmDeal.findMany({where:{accountId:id,status:{in:["DRAFT","SENT"]},validUntil:{gte:todayParis()}},select:{id:true,ref:true,description:true},orderBy:{createdAt:"desc"},take:100}),
    ]);
    return {enabled:this.enabled(),email:address.success?address.data:null,permission,mails,appointments,deals};
  }
  @Post(":accountId/communications/permission")
  async permission(@Req() req:any,@Param("accountId") id:string,@Body() raw:unknown){
    const a=await this.account(id), address=parse(emailAddress,a.email), data=parse(permissionSchema,raw);
    return this.prisma.$transaction(async tx=>{
      const p=await tx.crmEmailPermission.upsert({where:{email:address},create:{email:address,...data},update:data});
      await tx.auditLog.create({data:{actor:req.admin.actor,action:data.allowed?"crm.email_allowed":"crm.email_blocked",entity:"CrmAccount",entityId:id}});
      return p;
    });
  }
  @Post(":accountId/communications/drafts")
  async draft(@Req() req:any,@Param("accountId") id:string,@Body() raw:unknown){
    const a=await this.account(id), recipient=parse(emailAddress,a.email), input=parse(draftSchema,raw);
    const vars={company:a.name,contact:a.contactName||"Madame, Monsieur"};
    let body=renderTemplate(input.body,vars), subject=renderTemplate(input.subject,vars).replace(/[\r\n]/g," ");
    if(input.dealId){
      const d=await this.prisma.crmDeal.findFirst({where:{id:input.dealId,accountId:id,status:{in:["DRAFT","SENT"]},validUntil:{gte:todayParis()}}});
      if(!d)throw new HttpException("Devis indisponible ou expiré",409);
      body+="\n\n"+quoteText(d);
    }
    if(subject.length>180||body.length>12000)throw new HttpException("Message trop long",422);
    body+="\n\nPour ne plus recevoir de communications commerciales, répondez à ce message en demandant votre retrait.";
    return this.prisma.crmMail.create({data:{accountId:id,recipient,kind:input.kind,dealId:input.dealId,subject,body,actor:req.admin.actor}});
  }
  @Post(":accountId/communications/drafts/:mailId/send")
  async send(@Req() req:any,@Param("accountId") id:string,@Param("mailId") mailId:string,@Body() raw:unknown){
    parse(sendSchema,raw);
    if(!this.enabled())throw new HttpException("Envoi CRM désactivé ou prestataire non configuré",409);
    const provider=this.email.provider!;
    const mail=await this.prisma.$transaction(async tx=>{
      const m=await tx.crmMail.findFirst({where:{id:mailId,accountId:id},include:{account:true}});
      if(!m||m.status!=="DRAFT")throw new HttpException("Brouillon indisponible ou déjà traité",409);
      const current=emailAddress.safeParse(m.account.email);
      if(!current.success||current.data!==m.recipient)throw new HttpException("Adresse modifiée : recréez le brouillon",409);
      const p=await tx.crmEmailPermission.findUnique({where:{email:m.recipient}});
      if(!p?.allowed)throw new HttpException("Autorisation absente ou opposition enregistrée",403);
      if(m.kind==="QUOTE"&&(!m.dealId||!await tx.crmDeal.findFirst({where:{id:m.dealId,accountId:id,status:{in:["DRAFT","SENT"]},validUntil:{gte:todayParis()}}})))throw new HttpException("Devis expiré ou indisponible",409);
      const claim=await tx.crmMail.updateMany({where:{id:mailId,status:"DRAFT"},data:{status:"SENDING"}});
      if(!claim.count)throw new HttpException("Brouillon déjà traité",409);
      await tx.auditLog.create({data:{actor:req.admin.actor,action:"crm.mail_claimed",entity:"CrmMail",entityId:mailId}});
      return m;
    });
    try{await provider.send({to:mail.recipient,subject:mail.subject,text:mail.body});}
    catch{
      await this.prisma.crmMail.update({where:{id:mailId},data:{status:"UNKNOWN"}});
      throw new HttpException("Résultat non confirmé. Vérifiez auprès du prestataire avant tout nouvel envoi.",502);
    }
    await this.prisma.$transaction(async tx=>{
      await tx.crmMail.update({where:{id:mailId},data:{status:"ACCEPTED",acceptedAt:new Date()}});
      await tx.crmInteraction.create({data:{accountId:id,kind:"EMAIL",note:"Message accepté par le prestataire : "+mail.subject,actor:req.admin.actor}});
      if(mail.dealId){
        await tx.crmDeal.updateMany({where:{id:mail.dealId,accountId:id,status:"DRAFT"},data:{status:"SENT",sentAt:new Date()}});
        await tx.crmAccount.updateMany({where:{id,stage:{in:["PROSPECT","CONTACTED"]}},data:{stage:"OFFER"}});
      }
      await tx.auditLog.create({data:{actor:req.admin.actor,action:"crm.mail_accepted",entity:"CrmMail",entityId:mailId}});
    });
    return {ok:true,status:"ACCEPTED"};
  }
  @Post(":accountId/communications/appointments")
  async appointment(@Req() req:any,@Param("accountId") id:string,@Body() raw:unknown){
    await this.account(id);
    const data=parse(appointmentSchema,raw);
    return this.prisma.$transaction(async tx=>{
      const a=await tx.crmAppointment.create({data:{accountId:id,...data}});
      await tx.auditLog.create({data:{actor:req.admin.actor,action:"crm.appointment_created",entity:"CrmAppointment",entityId:a.id}});
      return a;
    });
  }
  @Post(":accountId/communications/appointments/:appointmentId/complete")
  async complete(@Req() req:any,@Param("accountId") id:string,@Param("appointmentId") appointmentId:string){
    return this.prisma.$transaction(async tx=>{
      const a=await tx.crmAppointment.findFirst({where:{id:appointmentId,accountId:id,doneAt:null}});
      if(!a||!(await tx.crmAppointment.updateMany({where:{id:appointmentId,doneAt:null},data:{doneAt:new Date()}})).count)throw new HttpException("Rendez-vous indisponible ou terminé",409);
      await tx.crmInteraction.create({data:{accountId:id,kind:"MEETING",note:"Rendez-vous terminé : "+a.title,actor:req.admin.actor}});
      await tx.auditLog.create({data:{actor:req.admin.actor,action:"crm.appointment_completed",entity:"CrmAppointment",entityId:appointmentId}});
      return {ok:true};
    });
  }
}
