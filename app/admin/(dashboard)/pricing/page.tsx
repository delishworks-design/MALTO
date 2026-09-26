"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type Rules={
  hourly_rate:number; distance_rate_per_km:number; job_size_rate_per_sqm:number;
  company_margin_pct:number; min_charge:number;
};
type Svc={id:string;name:string;hours:number;cleaners:number};
type Card={id:string;label:string;amount:string;suffix:string;sort_order:number;active:boolean;isNew?:boolean};

const round50=(n:number)=>Math.ceil(n/50)*50;
const money=(n:number)=>`₱${Math.round(n).toLocaleString("en-PH")}`;

export default function PricingAdmin(){
  const [rules,setRules]=useState<Rules>({hourly_rate:0,distance_rate_per_km:0,job_size_rate_per_sqm:0,company_margin_pct:0,min_charge:0});
  const [services,setServices]=useState<Svc[]>([]);
  const [cards,setCards]=useState<Card[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);

  const [svcId,setSvcId]=useState("");
  const [hours,setHours]=useState("5");
  const [cleaners,setCleaners]=useState("1");
  const [sqm,setSqm]=useState("45");
  const [km,setKm]=useState("5");

  const flash=(m:string)=>{ setNotice(m); setTimeout(()=>setNotice(null),2600); };

  const load=useCallback(async()=>{
    setLoading(true); setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user) return;
      const [{data:rr,error:e1},{data:ss,error:e2},{data:cc,error:e3}]=await Promise.all([
        supabase.from("pricing_rules").select("*").limit(1),
        supabase.from("services").select("id,name,sort_order,active").order("sort_order"),
        supabase.from("price_cards").select("*").order("sort_order")
      ]);
      if(e1) throw e1; if(e2) throw e2; if(e3) throw e3;

      if(rr&&rr[0]) setRules({
        hourly_rate:Number(rr[0].hourly_rate),
        distance_rate_per_km:Number(rr[0].distance_rate_per_km),
        job_size_rate_per_sqm:Number(rr[0].job_size_rate_per_sqm),
        company_margin_pct:Number(rr[0].company_margin_pct),
        min_charge:Number(rr[0].min_charge)
      });

      const rateIds=(ss||[]).map(s=>s.id);
      let rates:any[]=[];
      if(rateIds.length){
        const {data:rt,error:e4}=await supabase.from("service_rates").select("*").in("service_id",rateIds);
        if(e4) throw e4;
        rates=rt||[];
      }
      const rmap:Record<string,any>={};
      rates.forEach(r=>rmap[r.service_id]=r);
      const list=(ss||[]).map(s=>({
        id:s.id,name:s.name,
        hours:Number(rmap[s.id]?.default_hours??5),
        cleaners:Number(rmap[s.id]?.default_cleaners??1)
      }));
      setServices(list);
      if(list.length) setSvcId(cur=>cur||list[0].id);

      setCards((cc||[]).map(c=>({
        id:c.id,label:c.label,amount:String(c.amount),suffix:c.suffix,
        sort_order:c.sort_order,active:c.active
      })));
    }catch(e:any){ setError(e?.message||"Could not load pricing."); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ load(); },[load]);

  useEffect(()=>{
    const s=services.find(x=>x.id===svcId);
    if(s){ setHours(String(s.hours)); setCleaners(String(s.cleaners)); }
  },[svcId,services]);

  const calc=useMemo(()=>{
    const h=Number(hours)||0, c=Number(cleaners)||0, q=Number(sqm)||0, d=Number(km)||0;
    const labor=rules.hourly_rate*h*c;
    const size=rules.job_size_rate_per_sqm*q;
    const dist=rules.distance_rate_per_km*d;
    const subtotal=labor+size+dist;
    const margin=subtotal*(rules.company_margin_pct/100);
    const withMargin=subtotal+margin;
    const floored=Math.max(withMargin, rules.min_charge);
    return {labor,size,dist,subtotal,margin,withMargin,floored,final:round50(floored),appliedFloor:floored===rules.min_charge&&rules.min_charge>withMargin};
  },[rules,hours,cleaners,sqm,km]);

  const saveRules=async()=>{
    if(busy) return;
    setBusy("rules"); setError(null);
    try{
      const supabase=createClient();
      const {error:err}=await supabase.from("pricing_rules").upsert({
        id:1,
        hourly_rate:Number(rules.hourly_rate)||0,
        distance_rate_per_km:Number(rules.distance_rate_per_km)||0,
        job_size_rate_per_sqm:Number(rules.job_size_rate_per_sqm)||0,
        company_margin_pct:Number(rules.company_margin_pct)||0,
        min_charge:Number(rules.min_charge)||0
      });
      if(err) throw err;
      flash("Pricing rules saved.");
    }catch(e:any){ setError(e?.message||"Could not save rules."); }
    finally{ setBusy(null); }
  };

  const patchCard=(idx:number,p:Partial<Card>)=>setCards(l=>l.map((c,i)=>i===idx?{...c,...p}:c));

  const saveCard=async(card:Card,idx:number)=>{
    if(busy) return;
    setBusy(card.id||`n${idx}`); setError(null);
    try{
      const supabase=createClient();
      const amount=Number(String(card.amount).replace(/[^0-9.]/g,""));
      if(!card.label.trim()) throw new Error("Kailangan ng label.");
      if(Number.isNaN(amount)) throw new Error("Invalid amount.");
      if(card.isNew){
        const {error:err}=await supabase.from("price_cards")
          .insert({label:card.label.trim(),amount,suffix:card.suffix,sort_order:card.sort_order,active:card.active});
        if(err) throw err;
      }else{
        const {error:err}=await supabase.from("price_cards")
          .update({label:card.label.trim(),amount,suffix:card.suffix,sort_order:card.sort_order,active:card.active})
          .eq("id",card.id);
        if(err) throw err;
      }
      flash("Price card saved.");
      await load();
    }catch(e:any){
      setError(e?.code==="23505"?"May existing nang card na may ganyang label.":(e?.message||"Could not save."));
    }finally{ setBusy(null); }
  };

  const deleteCard=async(card:Card,idx:number)=>{
    if(!card.id) return;
    if(!confirm(`Delete "${card.label}"?`)) return;
    setBusy(card.id); setError(null);
    try{
      const supabase=createClient();
      const {error:err}=await supabase.from("price_cards").delete().eq("id",card.id);
      if(err) throw err;
      flash("Price card deleted.");
      await load();
    }catch(e:any){ setError(e?.message||"Could not delete."); }
    finally{ setBusy(null); }
  };

  if(loading) return <><div className="eyebrow">PRICING</div><h1>Price calculator.</h1><p className="text">Loading pricing…</p></>;

  return <>
    {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
    {notice&&<div className="notice">{notice}</div>}

    <div className="eyebrow">PRICING</div>
    <h1>Price calculator.</h1>
    <p className="small muted">Isang calculator na may logic: labor × hours × cleaners + laki ng trabaho + layo, tapos company margin, at floor sa minimum charge.</p>

    {/* ---------------- CALCULATOR ---------------- */}
    <div className="panel">
      <div className="panel-head"><strong>Calculator</strong><span className="small muted">Live estimate para sa booking</span></div>
      <div className="form-grid">
        <div className="field full">
          <label>Service</label>
          <select value={svcId} onChange={e=>setSvcId(e.target.value)}>
            {services.length===0&&<option value="">Walang service pa</option>}
            {services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Estimated hours</label>
          <input type="number" min={0} step={0.5} value={hours} onChange={e=>setHours(e.target.value)}/></div>
        <div className="field"><label>Number of cleaners</label>
          <input type="number" min={1} step={1} value={cleaners} onChange={e=>setCleaners(e.target.value)}/></div>
        <div className="field"><label>Approx. sqm</label>
          <input type="number" min={0} step={1} value={sqm} onChange={e=>setSqm(e.target.value)}/></div>
        <div className="field"><label>Distance (km)</label>
          <input type="number" min={0} step={0.5} value={km} onChange={e=>setKm(e.target.value)}/></div>
      </div>

      <div className="breakdown">
        <div><span>Labor ({rules.hourly_rate}/hr × {hours} hrs × {cleaners})</span><strong>{money(calc.labor)}</strong></div>
        <div><span>Job size ({rules.job_size_rate_per_sqm}/sqm × {sqm})</span><strong>{money(calc.size)}</strong></div>
        <div><span>Distance ({rules.distance_rate_per_km}/km × {km})</span><strong>{money(calc.dist)}</strong></div>
        <div className="sub"><span>Subtotal</span><strong>{money(calc.subtotal)}</strong></div>
        <div><span>Company margin ({rules.company_margin_pct}%)</span><strong>{money(calc.margin)}</strong></div>
        {calc.appliedFloor&&<div><span>Minimum charge applied</span><strong>{money(rules.min_charge)}</strong></div>}
        <div className="total"><span>QUOTED PRICE</span><strong>{money(calc.final)}</strong></div>
      </div>
    </div>

    {/* ---------------- RULES ---------------- */}
    <div className="panel">
      <div className="panel-head"><strong>Pricing rules</strong><span className="small muted">Pribado — hindi ito nakikita ng public website</span></div>
      <div className="form-grid">
        <div className="field"><label>Hourly rate per cleaner (₱)</label>
          <input type="number" min={0} value={rules.hourly_rate} onChange={e=>setRules(r=>({...r,hourly_rate:Number(e.target.value)||0}))}/></div>
        <div className="field"><label>Distance rate per km (₱)</label>
          <input type="number" min={0} value={rules.distance_rate_per_km} onChange={e=>setRules(r=>({...r,distance_rate_per_km:Number(e.target.value)||0}))}/></div>
        <div className="field"><label>Job size rate per sqm (₱)</label>
          <input type="number" min={0} value={rules.job_size_rate_per_sqm} onChange={e=>setRules(r=>({...r,job_size_rate_per_sqm:Number(e.target.value)||0}))}/></div>
        <div className="field"><label>Company margin (%)</label>
          <input type="number" min={0} max={500} value={rules.company_margin_pct} onChange={e=>setRules(r=>({...r,company_margin_pct:Number(e.target.value)||0}))}/></div>
        <div className="field"><label>Minimum charge (₱)</label>
          <input type="number" min={0} value={rules.min_charge} onChange={e=>setRules(r=>({...r,min_charge:Number(e.target.value)||0}))}/></div>
        <div className="field" style={{justifyContent:"flex-end"}}>
          <button className="btn" disabled={busy==="rules"} style={{minHeight:46,opacity:busy==="rules"?.6:1}} onClick={saveRules}>
            {busy==="rules"?"SAVING…":"SAVE RULES"}
          </button>
        </div>
      </div>
      <p className="small muted" style={{marginTop:14}}>
        Defaults na seed (palitan mo): {rules.hourly_rate}/hr · {rules.distance_rate_per_km}/km · {rules.job_size_rate_per_sqm}/sqm · margin {rules.company_margin_pct}% · min {money(rules.min_charge)}
      </p>
    </div>

    {/* ---------------- CARDS ---------------- */}
    <div className="panel">
      <div className="panel-head"><strong>Website price cards</strong><span className="small muted">Lumalabas sa homepage at /pricing</span></div>
      <div className="toolbar">
        <button className="btn" style={{minHeight:40}}
          onClick={()=>setCards(l=>[{id:"",label:"",amount:"",suffix:"+",sort_order:l.length+1,active:true,isNew:true},...l])}>
          + ADD CARD
        </button>
        <span className="small muted">Preview: {cards[0]?`₱${Number(cards[0].amount||0).toLocaleString("en-PH")}${cards[0].suffix}`:"—"}</span>
      </div>
      <div className="table">
        <table>
          <thead><tr><th>Label</th><th>Amount</th><th>Suffix</th><th>Order</th><th>Show</th><th>Preview</th><th></th></tr></thead>
          <tbody>{cards.map((c,idx)=><tr key={c.id||`n${idx}`}>
            <td><input value={c.label} placeholder="1BR" onChange={e=>patchCard(idx,{label:e.target.value})}/></td>
            <td><input inputMode="decimal" value={c.amount} placeholder="2800" style={{width:110}} onChange={e=>patchCard(idx,{amount:e.target.value})}/></td>
            <td><input value={c.suffix} style={{width:70}} onChange={e=>patchCard(idx,{suffix:e.target.value})}/></td>
            <td><input type="number" value={c.sort_order} style={{width:70}} onChange={e=>patchCard(idx,{sort_order:Number(e.target.value)||0})}/></td>
            <td><button className={"pill"+(c.active?" active":"")} onClick={()=>patchCard(idx,{active:!c.active})}>{c.active?"Shown":"Hidden"}</button></td>
            <td className="small">₱{Number(String(c.amount).replace(/[^0-9.]/g,"")||0).toLocaleString("en-PH")}{c.suffix}</td>
            <td style={{whiteSpace:"nowrap"}}>
              <button className="btn" style={{minHeight:34,padding:"0 13px"}} disabled={busy===(c.id||`n${idx}`)} onClick={()=>saveCard(c,idx)}>
                {busy===(c.id||`n${idx}`)?"…":"SAVE"}
              </button>
              {c.id&&<button className="btn secondary" style={{minHeight:34,padding:"0 13px",marginLeft:8}} disabled={busy===c.id} onClick={()=>deleteCard(c,idx)}>DEL</button>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  </>;
}
