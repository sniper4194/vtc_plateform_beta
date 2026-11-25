import {PrismaClient} from "@prisma/client";
import {checkStagingEnv} from "../staging";
import {DEFAULT_FLAT_RATES,DEFAULT_PRICING} from "../quotes.service";
async function main(){
 if(process.env.APP_ENV!=="staging")throw new Error("Réservé à la préproduction");
 checkStagingEnv(process.env);
 const db=new PrismaClient();
 try{
  if(!await db.pricingRuleSet.count())await db.pricingRuleSet.create({data:{name:"Grille de test",config:DEFAULT_PRICING as any}});
  if(!await db.flatRate.count())for(const f of DEFAULT_FLAT_RATES)await db.flatRate.create({data:{fromZone:f.fromZone,toZone:f.toZone,bidirectional:!!f.bidirectional,prices:f.prices as any}});
  const email="chauffeur-test@example.invalid",phone="+447700900001";
  let d=await db.driver.findUnique({where:{email}});
  if(!d)d=await db.driver.create({data:{email,phone,firstName:"Chauffeur",lastName:"TEST",status:"ACTIVE",vehicles:{create:{plate:"TEST-001",make:"Toyota",model:"Camry",category:"BERLINE"}}}});
  console.log("Chauffeur fictif disponible : "+d.phone+" ; aucun SMS réel.");
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
