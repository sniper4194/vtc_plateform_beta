import {randomBytes,scrypt as rawScrypt,timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import {z} from "zod";
import {passwordRules} from "./password-policy";
const scrypt=promisify(rawScrypt) as (p:string,s:Buffer,k:number,o:object)=>Promise<Buffer>;
const opts={N:32768,r:8,p:3,maxmem:64*1024*1024};
export const SESSION_SECONDS=30*86400, DEVICE_MS=90*86400_000;
export const phoneSchema=z.string().min(6).max(40);
export const codeSchema=z.string().regex(/^\d{6}$/);
export const newPassword=z.string().superRefine((p,ctx)=>{for(const rule of passwordRules)if(!rule.test(p))ctx.addIssue({code:z.ZodIssueCode.custom,message:rule.label});});
export const existingPassword=z.string().min(1).max(128);
export const deviceKey=z.string().regex(/^[0-9a-f]{64}$/);
export const activateSchema=z.object({phone:phoneSchema,code:codeSchema,password:newPassword}).strict();
export const loginSchema=z.object({phone:phoneSchema,password:existingPassword,deviceKey:deviceKey.optional(),code:codeSchema.optional()}).strict();
export const challengeSchema=z.object({phone:phoneSchema,password:existingPassword}).strict();
export const adminSchema=z.object({reason:z.string().trim().min(10).max(500),verified:z.literal(true)}).strict();
export async function hashDriverPassword(p:string){const salt=randomBytes(16),key=await scrypt(p,salt,32,opts);return "scrypt-v1:"+salt.toString("hex")+":"+key.toString("hex");}
export async function verifyDriverPassword(p:string,h:string){const [alg,salt,key]=h.split(":");if(alg!=="scrypt-v1"||!salt||!key||!/^[0-9a-f]{32}$/.test(salt)||!/^[0-9a-f]{64}$/.test(key))return false;return timingSafeEqual(await scrypt(p,Buffer.from(salt,"hex"),32,opts),Buffer.from(key,"hex"));}
export function smsSegments(s:string){
 const basic="@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
 const extended="^{}\\[~]|€\f";
 let n=0;for(const ch of s){if(basic.includes(ch))n++;else if(extended.includes(ch))n+=2;else return Math.max(1,s.length<=70?1:Math.ceil(s.length/67));}
 return Math.max(1,n<=160?1:Math.ceil(n/153));
}
