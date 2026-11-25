"use client";
import {useEffect,useState} from "react";
import {api,dt} from "../lib/api";
type Account={id:string;name:string};
type Appointment={id:string;title:string;startsAt:string;endsAt:string;location:string|null;doneAt:string|null;account?:Account};
type Mail={id:string;kind:string;recipient:string;subject:string;body:string;status:"DRAFT"|"SENDING"|"ACCEPTED"|"UNKNOWN";createdAt:string};
type Template={id:string;name:string;subject:string;body:string};
type Deal={id:string;ref:number;description:string};
type Data={enabled:boolean;email:string|null;permission:{allowed:boolean;reason:string}|null;mails:Mail[];appointments:Appointment[];deals:Deal[]};
type Agenda={appointments:(Appointment&{account:Account})[];followUps:{id:string;name:string;nextAction:string;nextActionAt:string}[];renewals:{id:string;contractRef:string;renewalOn:string;endsOn:string;account:Account}[]};
type Kind="PROSPECTING"|"FOLLOW_UP"|"QUOTE"|"RENEWAL";
const builtins:Record<Kind,{subject:string;body:string}>={
 PROSPECTING:{subject:"Partenariat transport — CliCab",body:"Bonjour {{contact}},\n\nNous souhaitons vous présenter CliCab et échanger sur les besoins de transport de {{company}}. Seriez-vous disponible pour un rendez-vous ?\n\nCordialement,\nL’équipe CliCab"},
 FOLLOW_UP:{subject:"Suite à notre échange — CliCab",body:"Bonjour {{contact}},\n\nJe reviens vers vous au sujet de notre échange. Avez-vous eu le temps d’étudier notre proposition ?\n\nCordialement,\nL’équipe CliCab"},
 QUOTE:{subject:"Votre devis CliCab — {{company}}",body:"Bonjour {{contact}},\n\nVous trouverez ci-dessous notre proposition commerciale. Nous restons disponibles pour en discuter.\n\nCordialement,\nL’équipe CliCab"},
 RENEWAL:{subject:"Renouvellement du partenariat CliCab",body:"Bonjour {{contact}},\n\nNous souhaitons faire le point avec vous sur le renouvellement de notre partenariat avec {{company}}.\n\nCordialement,\nL’équipe CliCab"}
};
const labels:Record<string,string>={DRAFT:"Brouillon",SENDING:"Envoi à vérifier",ACCEPTED:"Accepté par le prestataire",UNKNOWN:"Résultat non confirmé"};
const date=(s:string)=>s.slice(0,10).split("-").reverse().join("/");
export function CrmAgenda({onOpen,revision}:{onOpen:(id:string)=>void;revision:number}){
 const [data,setData]=useState<Agenda|null>(null),[error,setError]=useState("");
 useEffect(()=>{let alive=true;api<Agenda>("/admin/crm/communications/agenda").then(r=>{if(alive){setData(r);setError("");}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[revision]);
 const rows=data?[...data.appointments.map(a=>({key:"a"+a.id,id:a.account.id,name:a.account.name,title:a.title,when:a.startsAt,kind:"Rendez-vous",day:false})),...data.followUps.map(a=>({key:"f"+a.id,id:a.id,name:a.name,title:a.nextAction,when:a.nextActionAt,kind:"Relance",day:false})),...data.renewals.map(a=>({key:"r"+a.id,id:a.account.id,name:a.account.name,title:a.contractRef,when:a.renewalOn,kind:"Renouvellement",day:true}))].sort((a,b)=>a.when.localeCompare(b.when)):[];
 return <div className="card"><h3>Agenda commercial · échéances et 60 prochains jours</h3>{error&&<p className="err">{error}</p>}{data&&!rows.length&&<p className="muted">Aucune action planifiée.</p>}<div style={{maxHeight:350,overflow:"auto"}}>{rows.map(r=><div key={r.key} className="row" style={{marginBottom:8,flexWrap:"wrap"}}><span className="chip">{r.kind}</span><b>{r.name}</b><span>{r.title} · {r.day?date(r.when):dt(r.when)}</span><button className="btn" onClick={()=>onOpen(r.id)}>Ouvrir</button></div>)}</div></div>;
}
function calendarFile(a:Appointment){
 const esc=(s:string)=>s.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r/g,"");
 const stamp=(s:string)=>new Date(s).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
 const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//CliCab//CRM//FR","CALSCALE:GREGORIAN","BEGIN:VEVENT","UID:"+a.id+"@clicab.fr","DTSTAMP:"+stamp(new Date().toISOString()),"DTSTART:"+stamp(a.startsAt),"DTEND:"+stamp(a.endsAt),"SUMMARY:"+esc(a.title),...(a.location?["LOCATION:"+esc(a.location)]:[]),"END:VEVENT","END:VCALENDAR"];
 const url=URL.createObjectURL(new Blob([lines.join("\r\n")+"\r\n"],{type:"text/calendar;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;link.download="clicab-rendez-vous.ics";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function CrmComms({accountId,onChange}:{accountId:string;onChange:()=>void}){
 const base="/admin/crm/"+accountId+"/communications";
 const [data,setData]=useState<Data|null>(null),[templates,setTemplates]=useState<Template[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false),[kind,setKind]=useState<Kind>("PROSPECTING"),[subject,setSubject]=useState(builtins.PROSPECTING.subject),[body,setBody]=useState(builtins.PROSPECTING.body),[dealId,setDealId]=useState(""),[reason,setReason]=useState(""),[templateName,setTemplateName]=useState(""),[appointment,setAppointment]=useState({title:"",startsAt:"",endsAt:"",location:""});
 const reload=async()=>{const [d,t]=await Promise.all([api<Data>(base),api<Template[]>("/admin/crm/communications/templates")]);setData(d);setTemplates(t);};
 useEffect(()=>{let alive=true;Promise.all([api<Data>(base),api<Template[]>("/admin/crm/communications/templates")]).then(([d,t])=>{if(alive){setData(d);setTemplates(t);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[base]);
 async function run(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();await reload();onChange();}catch(e:any){setError(e.message);try{await reload();}catch{}}finally{setBusy(false);}}
 function changeKind(v:Kind){setKind(v);setSubject(builtins[v].subject);setBody(builtins[v].body);setDealId("");}
 function saveDraft(e:React.FormEvent){e.preventDefault();void run(()=>api(base+"/drafts",{kind,subject,body,...(kind==="QUOTE"?{dealId}:{})}));}
 function permission(allowed:boolean){if(!reason.trim()||!window.confirm(allowed?"Confirmer que l’autorisation est documentée et qu’aucune opposition ne s’applique ?":"Enregistrer l’opposition pour cette adresse, toutes fiches confondues ?"))return;void run(async()=>{await api(base+"/permission",{allowed,reason});setReason("");});}
 function send(m:Mail){if(!window.confirm("Envoyer maintenant ce message à "+m.recipient+" ?"))return;void run(()=>api(base+"/drafts/"+m.id+"/send",{confirm:true}));}
 function saveAppointment(e:React.FormEvent){e.preventDefault();void run(async()=>{await api(base+"/appointments",{title:appointment.title,startsAt:new Date(appointment.startsAt).toISOString(),endsAt:new Date(appointment.endsAt).toISOString(),...(appointment.location.trim()?{location:appointment.location}:{})});setAppointment({title:"",startsAt:"",endsAt:"",location:""});});}
 return <section style={{margin:"24px 0"}}><h3>Communication commerciale</h3>
 {error&&<p className="err" role="alert">{error}</p>}
 <p className="muted">{data?.enabled?"Envoi unitaire disponible.":"Envoi réel désactivé ou non configuré."} Les brouillons restent disponibles.</p>
 <p>Adresse enregistrée : <b>{data?.email??"Non renseignée"}</b> · {data?.permission?.allowed?"Autorisation documentée":data?.permission?"Opposition / blocage":"Autorisation non renseignée"}</p>
 {data?.permission&&<p className="muted">{data.permission.reason}</p>}
 <div className="row" style={{flexWrap:"wrap"}}><input aria-label="Motif de l'autorisation ou opposition" placeholder="Motif documenté" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/><button className="btn" disabled={busy||!reason.trim()||!data?.email} onClick={()=>permission(true)}>Autoriser</button><button className="btn danger" disabled={busy||!reason.trim()||!data?.email} onClick={()=>permission(false)}>Bloquer / opposition</button></div>
 <form onSubmit={saveDraft} style={{display:"grid",gap:8,margin:"12px 0"}}>
 <fieldset disabled={busy} style={{display:"grid",gap:8,border:0,padding:0}}>
 <label>Type de message <select value={kind} onChange={e=>changeKind(e.target.value as Kind)}><option value="PROSPECTING">Prospection</option><option value="FOLLOW_UP">Relance</option><option value="QUOTE">Devis</option><option value="RENEWAL">Renouvellement</option></select></label>
 <label>Modèle personnalisé <select value="" onChange={e=>{const t=templates.find(x=>x.id===e.target.value);if(t){setSubject(t.subject);setBody(t.body);}}}><option value="">Choisir un modèle enregistré</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
 {kind==="QUOTE"&&<label>Devis à inclure (texte) <select required value={dealId} onChange={e=>setDealId(e.target.value)}><option value="">Choisir</option>{data?.deals.map(d=><option key={d.id} value={d.id}>DEV-{String(d.ref).padStart(6,"0")} · {d.description}</option>)}</select></label>}
 <label>Objet <input required maxLength={180} value={subject} onChange={e=>setSubject(e.target.value)}/></label><label>Message <textarea required rows={7} maxLength={4000} value={body} onChange={e=>setBody(e.target.value)}/></label>
 <p className="muted">Variables : {"{{company}}"} et {"{{contact}}"}. Le devis sélectionné et la mention d’opposition sont ajoutés au brouillon.</p>
 <button className="btn primary" disabled={!data?.email||kind==="QUOTE"&&!dealId}>Enregistrer le brouillon</button>
 <div className="row"><input aria-label="Nom du modèle" placeholder="Nom du modèle" maxLength={100} value={templateName} onChange={e=>setTemplateName(e.target.value)}/><button type="button" className="btn" disabled={!templateName.trim()||!subject.trim()||!body.trim()} onClick={()=>void run(async()=>{await api("/admin/crm/communications/templates",{name:templateName,subject,body});setTemplateName("");})}>Enregistrer comme modèle</button></div>
 </fieldset></form>
 <h3>Brouillons et journal des envois</h3>
 {data?.mails.map(m=><details key={m.id} style={{borderTop:"1px solid #aaa",padding:"10px 0"}}><summary><b>{m.subject}</b> · {labels[m.status]} · {dt(m.createdAt)}</summary><p>À : {m.recipient}</p><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{m.body}</p>{m.status==="DRAFT"&&<button className="btn primary" disabled={busy||!data.enabled||!data.permission?.allowed||data.email!==m.recipient} onClick={()=>send(m)}>Confirmer l'envoi</button>}</details>)}
 <h3 style={{marginTop:20}}>Rendez-vous</h3>
 <form onSubmit={saveAppointment} style={{display:"grid",gap:8}}>
 <fieldset disabled={busy} style={{display:"grid",gap:8,border:0,padding:0}}>
 <label>Intitulé <input required maxLength={160} value={appointment.title} onChange={e=>setAppointment(a=>({...a,title:e.target.value}))}/></label>
 <label>Début <input required type="datetime-local" value={appointment.startsAt} onChange={e=>setAppointment(a=>({...a,startsAt:e.target.value}))}/></label>
 <label>Fin <input required type="datetime-local" value={appointment.endsAt} onChange={e=>setAppointment(a=>({...a,endsAt:e.target.value}))}/></label>
 <label>Lieu ou modalité <input maxLength={300} value={appointment.location} onChange={e=>setAppointment(a=>({...a,location:e.target.value}))}/></label><button className="btn primary">Planifier</button></fieldset></form>
 {data?.appointments.map(a=><div key={a.id} className="row" style={{marginTop:8,flexWrap:"wrap"}}><b>{a.title}</b><span>{dt(a.startsAt)} – {dt(a.endsAt)} · {a.location??""}</span>{a.doneAt?<span className="chip">Terminé</span>:<><button className="btn" onClick={()=>calendarFile(a)}>Exporter .ics</button><button className="btn" disabled={busy} onClick={()=>{if(window.confirm("Marquer ce rendez-vous comme terminé ?"))void run(()=>api(base+"/appointments/"+a.id+"/complete",{}));}}>Terminer</button></>}</div>)}
 </section>;
}
