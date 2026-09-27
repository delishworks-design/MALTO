"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const fmtDate=(s?:string|null)=>{
  if(!s) return "—";
  const d=new Date(`${s}T00:00:00`);
  if(Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
};

const money=(p:any)=>{
  if(p===null||p===undefined||p==="") return "—";
  const n=typeof p==="number"?p:Number(String(p).replace(/[^0-9.]/g,""));
  return Number.isNaN(n)?String(p):`₱${n.toLocaleString("en-PH")}`;
};

type Customer={
  key:string; name:string; phone:string; email:string; city:string;
  bookings:any[]; last:string; total:number; active:number;
};

export default function Customers(){
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [search,setSearch]=useState("");
  const [open,setOpen]=useState<string|null>(null);

  const load=useCallback(async()=>{
    setLoading(true); setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user) return;
      const { data,error:err }=await supabase.from("bookings").select("*").order("created_at",{ascending:false});
      if(err) throw err;
      setRows(data||[]);
    }catch(e:any){ setError(e?.message||"Could not load customers."); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ load(); },[load]);

  const customers=useMemo(()=>{
    const map=new Map<string,Customer>();
    rows.forEach(b=>{
      const key=(b.phone||"").trim()||(b.email||"").trim()||(b.names||"").trim()||String(b.id);
      const existing=map.get(key);
      if(existing){
        existing.bookings.push(b);
        existing.total++;
        if(["Confirmed","In Progress"].includes(b.status)) existing.active++;
        if(String(b.created_at)>existing.last) existing.last=String(b.created_at);
        if(!existing.city&&b.city) existing.city=b.city;
        if(!existing.email&&b.email) existing.email=b.email;
      }else{
        map.set(key,{
          key,name:b.names||"—",phone:b.phone||"",email:b.email||"",city:b.city||"",
          bookings:[b],last:String(b.created_at||""),total:1,
          active:["Confirmed","In Progress"].includes(b.status)?1:0
        });
      }
    });
    let list=Array.from(map.values());
    const q=search.trim().toLowerCase();
    if(q) list=list.filter(c=>[c.name,c.phone,c.email,c.city].some(v=>v&&v.toLowerCase().includes(q)));
    list.sort((a,b)=>b.last.localeCompare(a.last));
    return list;
  },[rows,search]);

  const totalBookings=rows.length;

  return <>
    {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
    <div className="eyebrow">CUSTOMERS</div>
    <h1>Who books MALTO.</h1>
    <p className="small muted">
      {loading?"Loading…":`${customers.length} customer${customers.length===1?"":"s"} · ${totalBookings} booking${totalBookings===1?"":"s"} lahat`}
    </p>

    <div className="toolbar">
      <input className="search" type="search" placeholder="Search name, phone, email or city…"
        value={search} onChange={e=>setSearch(e.target.value)}/>
      <span className="small muted">Click a card to see their bookings.</span>
    </div>

    <div className="cards">
      {loading?<p className="text" style={{padding:20}}>Loading customers…</p>
      :customers.length===0?<p className="text" style={{padding:20}}>
        {rows.length===0?"No bookings yet, so there are no customers yet.":"No customer matches your search."}
      </p>
      :customers.map(c=>{
        const isOpen=open===c.key;
        return <div className="custcard" key={c.key} onClick={()=>setOpen(isOpen?null:c.key)}>
          <div className="custcard-head">
            <div>
              <strong className="custcard-name">{c.name}</strong>
              <div className="small muted">
                {[c.phone,c.email,c.city].filter(Boolean).join(" · ")||"No contact details"}
              </div>
            </div>
            <div className="custcard-stats">
              <span className="small muted">{c.total} booking{c.total===1?"":"s"}</span>
              <span className={"badge"+(c.active?" on":"")}>{c.active} aktibo</span>
              <span className="small muted">Huli: {c.last?new Date(c.last).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"}):"—"}</span>
            </div>
          </div>

          {isOpen&&<div className="custcard-body" onClick={e=>e.stopPropagation()}>
            <table>
              <thead><tr><th>Request ID</th><th>Date</th><th>Service</th><th>Status</th><th>Price</th></tr></thead>
              <tbody>{c.bookings.map(b=><tr key={b.id}>
                <td>{b.booking_ref||String(b.id).slice(0,8)}</td>
                <td>{fmtDate(b.date)}</td>
                <td>{b.services||"—"}</td>
                <td>{b.status||"—"}</td>
                <td>{money(b.price)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>;
      })}
    </div>
  </>;
}
