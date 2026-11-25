"use client";
import { useEffect, useState } from "react";
import { api, eur } from "../lib/api";
type Deal = { id:string; ref:number; status:string; issuerName:string; issuerAddress:string; issuerSiret:string; recipientName:string; recipientAddress:string; description:string; quantity:number; unitCents:number; vatBps:number; priceMultiplier:string; terms:string; validUntil:string; contractRef:string|null; startsOn:string|null; endsOn:string|null; renewalOn:string|null; netCents:number; vatCents:number; totalCents:number };
type Renewal = { id:string; ref:number; contractRef:string; renewalOn:string; endsOn:string; account:{id:string;name:string} };
const labels:Record<string,string> = { DRAFT:"Brouillon", SENT:"Envoyé", ACCEPTED:"Accepté", REJECTED:"Refusé", SIGNED:"Contrat signé" };
const date = (s:string|null) => s ? s.slice(0,10).split("-").reverse().join("/") : "—";
const ref = (n:number) => "DEV-" + String(n).padStart(6,"0");
function printDeal(d:Deal) {
  const w=window.open("", "_blank", "width=850,height=900");
  if(!w) throw new Error("Autorisez la fenêtre d'impression.");
  w.opener=null;
  const doc=w.document;
  doc.title=ref(d.ref)+" · CliCab";
  const style=doc.createElement("style");
  style.textContent="@page{size:A4;margin:18mm}body{font:14px system-ui;color:#14172b;max-width:780px;margin:24px auto}h1{color:#0f4a96;border-bottom:5px solid #f7b30a;padding:16px 0}h2{font-size:18px}p{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #bbb;text-align:left}th{background:#8fd0f5}strong{color:#0f4a96}@media print{button{display:none}body{margin:0}}";
  doc.head.append(style);
  const add=(tag:string,s:string)=>{const el=doc.createElement(tag);el.textContent=s;doc.body.append(el);return el;};
  add("h1","CliCab · Devis commercial "+ref(d.ref));
  add("p",labels[d.status]+" · Valable jusqu'au "+date(d.validUntil));
  add("h2","Émetteur");add("p",d.issuerName+"\n"+d.issuerAddress+"\nSIRET : "+d.issuerSiret);
  add("h2","Client");add("p",d.recipientName+"\n"+d.recipientAddress);
  add("h2","Prestation");add("p",d.description);
  const table=doc.createElement("table");
  for(const [i,row] of [["Quantité","Prix unitaire HT","Montant HT"],[String(d.quantity),eur(d.unitCents),eur(d.netCents)],["TVA",String(d.vatBps/100)+" %",eur(d.vatCents)],["Total TTC","",eur(d.totalCents)]].entries()){
    const tr=doc.createElement("tr");for(const value of row){const cell=doc.createElement(i===0?"th":"td");cell.textContent=value;tr.append(cell);}table.append(tr);
  }
  doc.body.append(table);
  add("h2","Conditions commerciales");add("p","Coefficient tarif partenaire : "+d.priceMultiplier+"\n"+d.terms);
  add("p","Document commercial — ne constitue pas une facture.");
  const button=add("button","Imprimer / Enregistrer en PDF");button.addEventListener("click",()=>w.print());
  w.focus();
}
const empty=()=>({issuerName:"",issuerAddress:"",issuerSiret:"",recipientAddress:"",description:"",quantity:"1",unitEuros:"",vat:"",multiplier:"1",terms:"",validUntil:""});
const sigEmpty=()=>({contractRef:"",startsOn:"",endsOn:"",renewalOn:""});
function cents(value:string){if(!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim()))throw new Error("Montant ou taux invalide (2 décimales maximum).");return Math.round(Number(value.replace(",","."))*100);}
function multiplier(value:string){if(!/^\d+(?:[.,]\d{1,4})?$/.test(value.trim()))throw new Error("Coefficient invalide (4 décimales maximum).");return Math.round(Number(value.replace(",","."))*10000);}
export function CrmRenewals({onOpen,revision}:{onOpen:(id:string)=>void;revision:number}){
  const [rows,setRows]=useState<Renewal[]|null>(null);const [error,setError]=useState("");
  useEffect(()=>{let alive=true;api<Renewal[]>("/admin/crm/renewals").then(r=>{if(alive){setRows(r);setError("");}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[revision]);
  return <div className="card"><h3>Renouvellements à traiter · 60 jours</h3>{error&&<p className="err">{error}</p>}{rows?.length===0&&<p className="muted">Aucune échéance.</p>}{rows?.map(r=><div key={r.id} className="row" style={{marginBottom:8,flexWrap:"wrap"}}><b>{r.account.name}</b><span>{r.contractRef} · Renouvellement {date(r.renewalOn)} · Fin {date(r.endsOn)}</span><button className="btn" onClick={()=>onOpen(r.account.id)}>Ouvrir</button></div>)}</div>;
}
export function CrmDeals({accountId,partnerId,onChange}:{accountId:string;partnerId:string|null;onChange:()=>void}){
  const [rows,setRows]=useState<Deal[]>([]);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [show,setShow]=useState(false);const [form,setForm]=useState(empty);const [signing,setSigning]=useState<string|null>(null);const [sig,setSig]=useState(sigEmpty);const [key,setKey]=useState("");
  const base="/admin/crm/"+accountId+"/deals";
  const reload=async()=>{setRows(await api<Deal[]>(base));};
  useEffect(()=>{let alive=true;api<Deal[]>(base).then(r=>{if(alive)setRows(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[base]);
  async function run(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();await reload();onChange();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function save(e:React.FormEvent){e.preventDefault();await run(async()=>{const {unitEuros,vat,multiplier:factor,quantity,...rest}=form;await api(base,{...rest,quantity:Number(quantity),unitCents:cents(unitEuros),vatBps:cents(vat),multiplierBps:multiplier(factor)});setForm(empty());setShow(false);});}
  function action(d:Deal,a:string){if(!window.confirm(a==="SEND"?"Confirmer l'envoi effectué en dehors de CliCab ?":a==="ACCEPT"?"Confirmer l'acceptation reçue du client ?":"Confirmer le refus du client ?"))return;void run(()=>api(base+"/"+d.id+"/action",{action:a}));}
  function sign(e:React.FormEvent){e.preventDefault();if(!signing||!window.confirm("Confirmer qu'un contrat a réellement été signé hors de CliCab ?"))return;void run(async()=>{await api(base+"/"+signing+"/sign",sig);setSigning(null);setSig(sigEmpty());});}
  function provision(d:Deal){if(!window.confirm("Créer le partenaire et une clé de test uniquement ?"))return;void run(async()=>{const r=await api<{apiKey:string}>(base+"/"+d.id+"/provision",{});setKey(r.apiKey);});}
  return <section style={{margin:"24px 0"}}>
    <h3>Devis et contrats commerciaux</h3>
    <p className="muted">Envoi et signature constatés manuellement. Vérifiez les mentions légales et la TVA avant transmission.</p>
    {error&&<p className="err" role="alert">{error}</p>}
    {key&&<div className="card"><b>Clé sandbox — à copier maintenant</b><p style={{overflowWrap:"anywhere"}}>{key}</p><button className="btn" onClick={()=>setKey("")}>Masquer définitivement</button></div>}
    <button className="btn primary" disabled={busy} onClick={()=>setShow(!show)}>{show?"Fermer":"Nouveau devis"}</button>
    {show&&<form onSubmit={save} style={{display:"grid",gap:8,margin:"12px 0"}}>
      <fieldset disabled={busy} style={{display:"grid",gap:8,border:0,padding:0}}>
        {([["issuerName","Raison sociale émetteur",160],["issuerAddress","Adresse émetteur",300],["issuerSiret","SIRET (14 chiffres)",14],["recipientAddress","Adresse du client",300],["description","Prestation",500]] as const).map(([k,label,max])=><label key={k}>{label} <input required maxLength={max} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/></label>)}
        <label>Quantité <input type="number" required min="1" max="10000" step="1" value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))}/></label>
        <label>Prix unitaire HT (€) <input required inputMode="decimal" value={form.unitEuros} onChange={e=>setForm(f=>({...f,unitEuros:e.target.value}))}/></label>
        <label>TVA (%) <input required inputMode="decimal" value={form.vat} onChange={e=>setForm(f=>({...f,vat:e.target.value}))}/></label>
        <label>Coefficient tarif partenaire <input required inputMode="decimal" value={form.multiplier} onChange={e=>setForm(f=>({...f,multiplier:e.target.value}))}/></label>
        <label>Validité <input type="date" required value={form.validUntil} onChange={e=>setForm(f=>({...f,validUntil:e.target.value}))}/></label>
        <label>Conditions et modalités de paiement <textarea required maxLength={1500} value={form.terms} onChange={e=>setForm(f=>({...f,terms:e.target.value}))}/></label>
        <button type="submit" className="btn primary">Enregistrer le devis</button>
      </fieldset>
    </form>}
    {rows.map(d=><div key={d.id} style={{borderTop:"1px solid #aaa",padding:"12px 0"}}>
      <div className="row" style={{flexWrap:"wrap"}}><b>{ref(d.ref)}</b><span className="chip">{labels[d.status]}</span><span>{eur(d.totalCents)} TTC · Validité {date(d.validUntil)}</span><button className="btn" onClick={()=>{try{printDeal(d);}catch(e:any){setError(e.message);}}}>PDF / Imprimer</button></div>
      <p>{d.description} · Coefficient {d.priceMultiplier}</p>
      <div className="row" style={{flexWrap:"wrap"}}>
        {d.status==="DRAFT"&&<button className="btn" disabled={busy} onClick={()=>action(d,"SEND")}>Marquer envoyé</button>}
        {d.status==="SENT"&&<><button className="btn" disabled={busy} onClick={()=>action(d,"ACCEPT")}>Accepté</button><button className="btn" disabled={busy} onClick={()=>action(d,"REJECT")}>Refusé</button></>}
        {d.status==="ACCEPTED"&&<button className="btn" disabled={busy} onClick={()=>{setSigning(d.id);setSig(sigEmpty());}}>Enregistrer le contrat signé</button>}
        {d.status==="SIGNED"&&<><span>Contrat {d.contractRef} · {date(d.startsOn)} au {date(d.endsOn)} · Renouvellement {date(d.renewalOn)}</span>{!partnerId&&!key&&<button className="btn" disabled={busy} onClick={()=>provision(d)}>Créer partenaire (sandbox)</button>}</>}
      </div>
      {signing===d.id&&<form onSubmit={sign} style={{display:"grid",gap:8,marginTop:10}}>
        <label>Référence du contrat externe <input required maxLength={160} value={sig.contractRef} onChange={e=>setSig(s=>({...s,contractRef:e.target.value}))}/></label>
        {([["startsOn","Début"],["endsOn","Fin"],["renewalOn","Échéance de renouvellement"]] as const).map(([k,label])=><label key={k}>{label} <input required type="date" value={sig[k]} onChange={e=>setSig(s=>({...s,[k]:e.target.value}))}/></label>)}
        <div className="row"><button className="btn primary" disabled={busy}>Confirmer</button><button type="button" className="btn" onClick={()=>setSigning(null)}>Annuler</button></div>
      </form>}
    </div>)}
    {!rows.length&&<p className="muted">Aucun devis enregistré.</p>}
  </section>;
}
