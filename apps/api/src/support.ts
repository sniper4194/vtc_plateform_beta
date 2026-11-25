import {z} from "zod";
export const priorities=["LOW","NORMAL","HIGH","URGENT"] as const;
export const statuses=["OPEN","IN_PROGRESS","WAITING","RESOLVED","CLOSED"] as const;
const text=(max:number)=>z.string().trim().min(1).max(max), id=z.string().uuid(), version=z.number().int().min(0);
export const ticketSchema=z.object({title:text(160),description:text(4000),source:z.enum(["CLIENT","DRIVER","PARTNER","INTERNAL"]),category:z.enum(["DELAY","NO_SHOW","DRIVER","PASSENGER","PAYMENT","LOST_ITEM","SAFETY","TECHNICAL","OTHER"]),priority:z.enum(priorities),rideRef:z.number().int().positive().max(2147483647).optional(),driverId:id.optional(),partnerId:id.optional(),incidentId:id.optional(),accountId:id.optional(),assigneeId:id.optional()}).strict();
export const querySchema=z.object({q:z.string().trim().max(160).default(""),status:z.enum(statuses).optional(),priority:z.enum(priorities).optional(),overdue:z.enum(["1","0"]).optional(),page:z.coerce.number().int().min(1).max(10000).default(1)}).strict();
export const assignSchema=z.object({version,assigneeId:id.nullable()}).strict();
export const noteSchema=z.object({version,note:text(2000)}).strict();
export const transitionSchema=z.object({version,status:z.enum(statuses),note:text(2000)}).strict();
export const moneySchema=z.object({version,kind:z.enum(["REFUND","COMPENSATION"]),amountCents:z.number().int().min(1).max(1000000),reason:text(1000)}).strict();
export const decisionSchema=z.object({version,decision:z.enum(["APPROVED","REJECTED"]),reason:text(1000)}).strict();
export const ratingSchema=z.object({version,score:z.number().int().min(1).max(5),note:text(500)}).strict();
const hours:Record<typeof priorities[number],[number,number]>={LOW:[24,120],NORMAL:[8,72],HIGH:[2,24],URGENT:[0.5,4]};
export function deadlines(priority:typeof priorities[number],now:Date){const [response,resolution]=hours[priority];return {firstResponseDueAt:new Date(now.getTime()+response*3600000),resolutionDueAt:new Date(now.getTime()+resolution*3600000)};}
export function canTransition(from:string,to:string){const allowed:Record<string,string[]>={OPEN:["IN_PROGRESS"],IN_PROGRESS:["WAITING","RESOLVED"],WAITING:["IN_PROGRESS","RESOLVED"],RESOLVED:["CLOSED"],CLOSED:[]};return allowed[from]?.includes(to)??false;}
