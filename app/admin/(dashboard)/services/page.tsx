"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type Row={
  id:string; name:string; description:string; sort_order:string; active:boolean;
  hours:string; cleaners:string; isNew?:boolean;
};

// Coerced on save, never in onChange, so a cleared box can stay empty.
const num=(v:string|number)=>Number(String(v).replace(/[^0-9.]/g,""))||0;

const empty=():Row=>({id:"",name:"",description:"",sort_order:"99",active:true,hours:"5",cleaners:"1",isNew:true});

export default function ServicesAdmin(){
  const [items,setItems]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);

  const flash=(m:string)=>{ setNotice(m); setTimeout(()=>setNotice(null),2600); };

  const load=useCallback(async()=>{
    setLoading(true); setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user) return;
      const [{data:s,error:e1},{data:r,error:e2}]=await Promise.all([
        supabase.from("services").select("*").order("sort_order",{ascending:true}),
        supabase.from("service_rates").select("*")
      ]);
      if(e1) throw e1;
      if(e2) throw e2;
      const rateMap:Record<string,any>={};
      (r||[]).forEach((x:any)=>rateMap[x.service_id]=x);
      setItems((s||[]).map((x:any)=>({
        id:x.id,name:x.name,description:x.description,sort_order:String(x.sort_order),active:x.active,
        hours:String(rateMap[x.id]?.default_hours??5),
        cleaners:String(rateMap[x.id]?.default_cleaners??1)
      })));
    }catch(e:any){ setError(e?.message||"Could not load services."); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ load(); },[load]);

  const patch=(id:string,p:Partial<Row>)=>setItems(list=>list.map(x=>x.id===id?{...x,...p}:x));

  const save=async(row:Row)=>{
    if(busy) return;
    setBusy(row.id||"new"); setError(null);
    try{
      const supabase=createClient();
      const hours=Number(row.hours); const cleaners=Number(row.cleaners);
      if(!row.name.trim()) throw new Error("A service name is required.");
      if(Number.isNaN(hours)||hours<0) throw new Error("Invalid hours.");
      if(Number.isNaN(cleaners)||cleaners<1) throw new Error("Invalid number of cleaners.");

      let id=row.id;
      if(row.isNew){
        const {data,error:err}=await supabase.from("services").insert({
          name:row.name.trim(),description:row.description,sort_order:num(row.sort_order),active:row.active
        }).select("id").single();
        if(err) throw err;
        id=data.id;
        const {error:rerr}=await supabase.from("service_rates")
          .insert({service_id:id,default_hours:hours,default_cleaners:cleaners});
        if(rerr) throw rerr;
      }else{
        const {error:err}=await supabase.from("services")
          .update({name:row.name.trim(),description:row.description,sort_order:num(row.sort_order),active:row.active})
          .eq("id",row.id);
        if(err) throw err;
        const {error:rerr}=await supabase.from("service_rates")
          .upsert({service_id:row.id,default_hours:hours,default_cleaners:cleaners});
        if(rerr) throw rerr;
      }
      flash(row.isNew?"Service added.":"Service saved.");
      await load();
    }catch(e:any){
      setError(e?.code==="23505"?"A service with that name already exists.":(e?.message||"Could not save."));
    }finally{ setBusy(null); }
  };

  const remove=async(row:Row)=>{
    if(!row.id) return;
    if(!confirm(`Delete "${row.name}"? Bookings that use this service will not be deleted.`)) return;
    setBusy(row.id); setError(null);
    try{
      const supabase=createClient();
      const {error:err}=await supabase.from("services").delete().eq("id",row.id);
      if(err) throw err;
      flash("Service deleted.");
      await load();
    }catch(e:any){ setError(e?.message||"Could not delete."); }
    finally{ setBusy(null); }
  };

  const toggleActive=async(row:Row)=>{
    if(!row.id) return;
    setBusy(row.id); setError(null);
    try{
      const supabase=createClient();
      const {error:err}=await supabase.from("services").update({active:!row.active}).eq("id",row.id);
      if(err) throw err;
      setItems(list=>list.map(x=>x.id===row.id?{...x,active:!x.active}:x));
      flash(row.active?"Service hidden from website.":"Service shown on website.");
    }catch(e:any){ setError(e?.message||"Could not update."); }
    finally{ setBusy(null); }
  };

  return <>
    {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
    {notice&&<div className="notice">{notice}</div>}

    <div className="eyebrow">SERVICES</div>
    <h1>Scope of work.</h1>
    <p className="small muted">The active services here are what appear on the homepage, on /services and in step 1 of the booking form.</p>

    <div className="toolbar">
      <button className="btn" style={{minHeight:42}}
        onClick={()=>{ setItems(l=>[empty(),...l]); setError(null); }}>+ ADD SERVICE</button>
      <span className="small muted">Edit the contents, then press SAVE on the row.</span>
    </div>

    <div className="table">
      {loading?<p className="text" style={{padding:20}}>Loading services…</p>
      :items.length===0?<p className="text" style={{padding:20}}>No services yet. Use “+ ADD SERVICE”.</p>
      :<table>
        <thead><tr>
          <th>Name</th><th>Description</th><th>Hours</th><th>Cleaners</th><th>Order</th><th>Website</th><th></th>
        </tr></thead>
        <tbody>{items.map(row=><tr key={row.id||row.name}>
          <td><input value={row.name} onChange={e=>patch(row.id,{name:e.target.value})} placeholder="Home Cleaning"/></td>
          <td><input value={row.description} onChange={e=>patch(row.id,{description:e.target.value})} placeholder="Description"/></td>
          <td><input type="number" min={0} step={0.5} style={{width:80}} value={row.hours} onChange={e=>patch(row.id,{hours:e.target.value})}/></td>
          <td><input type="number" min={1} step={1} style={{width:70}} value={row.cleaners} onChange={e=>patch(row.id,{cleaners:e.target.value})}/></td>
          <td><input type="number" style={{width:70}} value={row.sort_order} onChange={e=>patch(row.id,{sort_order:e.target.value})}/></td>
          <td>
            <button className={"pill"+(row.active?" active":"")} onClick={()=>toggleActive(row)} disabled={!!row.isNew}>
              {row.active?"Visible":"Hidden"}
            </button>
          </td>
          <td style={{whiteSpace:"nowrap"}}>
            <button className="btn" style={{minHeight:36,padding:"0 14px"}} disabled={busy===row.id} onClick={()=>save(row)}>
              {busy===row.id?"SAVING…":"SAVE"}
            </button>
            {row.id&&!row.isNew&&<button className="btn secondary" style={{minHeight:36,padding:"0 14px",marginLeft:8}}
              disabled={busy===row.id} onClick={()=>remove(row)}>DELETE</button>}
          </td>
        </tr>)}</tbody>
      </table>}
    </div>
  </>;
}
