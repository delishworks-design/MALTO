"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const STATUSES=["New Request","Confirmed","In Progress","Completed","Cancelled"];
const PHOTO_BUCKET="booking-photos";

const pad=(n:number)=>String(n).padStart(2,"0");
const toISO=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function friendlyError(error:any){
  const msg=String(error?.message||"");
  if(error?.code==="42501"||/permission denied/i.test(msg))
    return "You do not have permission to do that. The RLS policies for the admin role still need to be configured.";
  if(error?.code==="42P01"||/does not exist/i.test(msg))
    return "The booking tables are not set up yet. Please run the migration SQL in the Supabase SQL Editor.";
  if(/Failed to fetch|NetworkError|fetch failed/i.test(msg))
    return "Could not reach the booking service. Please check your connection and refresh.";
  return msg||"Something went wrong. Please try again.";
}

const formatPrice=(p:any)=>{
  if(p===null||p===undefined||p==="") return "—";
  if(typeof p==="number") return `₱${p.toLocaleString("en-PH")}`;
  const s=String(p).trim();
  if(!s) return "—";
  return s.startsWith("₱")?s:`₱${s}`;
};

export default function Admin(){
  const router=useRouter();
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [userEmail,setUserEmail]=useState("");
  const [photos,setPhotos]=useState<Record<string,string>>({});
  const [priceDraft,setPriceDraft]=useState<Record<string,string>>({});

  const load=useCallback(async()=>{
    setLoading(true);
    setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user){ router.replace("/admin/login"); return; }
      setUserEmail(user.email||"");

      const { data,error:err }=await supabase.from("bookings").select("*").order("created_at",{ascending:false});
      if(err) throw err;
      setRows(data||[]);
    }catch(err:any){
      setError(friendlyError(err));
    }finally{
      setLoading(false);
    }
  },[router]);

  useEffect(()=>{load();},[load]);

  const kpis=useMemo(()=>{
    const today=toISO(new Date());
    const active=["Confirmed","In Progress"];
    const c=(s:string)=>rows.filter(r=>r.status===s).length;
    return [
      ["New Requests",c("New Request")],
      ["In Progress",c("In Progress")],
      ["Confirmed",c("Confirmed")],
      ["Today's Jobs",rows.filter(r=>r.date===today&&active.includes(r.status)).length],
      ["Upcoming",rows.filter(r=>r.date&&r.date>today&&active.includes(r.status)).length]
    ];
  },[rows]);

  const updateStatus=async(id:string,status:string)=>{
    if(busy) return;
    setBusy(id);
    setError(null);
    try{
      const supabase=createClient();
      const { error:err }=await supabase.from("bookings").update({status}).eq("id",id);
      if(err) throw err;
      setRows(rs=>rs.map(r=>r.id===id?{...r,status}:r));
      setNotice("Status updated.");
      setTimeout(()=>setNotice(null),2500);
    }catch(err:any){
      setError(friendlyError(err));
    }finally{
      setBusy(null);
    }
  };

  const updatePrice=async(id:string)=>{
    if(busy) return;
    setBusy(id);
    setError(null);
    try{
      const raw=(priceDraft[id]??"").trim();
      const value=raw===""?null:Number(raw.replace(/[^0-9.]/g,""));
      if(raw!==""&&(value===null||Number.isNaN(value))) throw new Error("Enter a valid price.");
      const supabase=createClient();
      const { error:err }=await supabase.from("bookings").update({price:value}).eq("id",id);
      if(err) throw err;
      setRows(rs=>rs.map(r=>r.id===id?{...r,price:value}:r));
      setNotice("Price updated.");
      setTimeout(()=>setNotice(null),2500);
    }catch(err:any){
      setError(friendlyError(err));
    }finally{
      setBusy(null);
    }
  };

  const loadPhoto=async(b:any)=>{
    if(!b.photo_path||photos[b.id]) return;
    try{
      const supabase=createClient();
      const { data,error:err }=await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(b.photo_path,3600);
      if(!err&&data?.signedUrl) setPhotos(p=>({...p,[b.id]:data.signedUrl}));
    }catch{/* photo is optional */}
  };

  const toggleRow=(b:any)=>{
    const next=expanded===b.id?null:b.id;
    setExpanded(next);
    if(next&&b.photo_path) loadPhoto(b);
  };

  const signOut=async()=>{
    try{ await createClient().auth.signOut(); }catch{/* ignore */}
    router.replace("/admin/login");
    router.refresh();
  };

  const detailRows=(b:any):[string,any][]=>[
    ["Full name",b.names],["Mobile",b.phone],["Email",b.email],
    ["Property",b.property],["Approx. sqm",b.sqm],["Bedrooms",b.bedrooms],["Bathrooms",b.bathrooms],
    ["Areas",b.areas],["Condition",b.condition],["Scope notes",b.scope_notes],
    ["Materials",b.materials],
    ["Address",b.adress],["City / Municipality",b.city],["Province",b.province],
    ["Landmark",b.landmark],["Access instructions",b.access],
    ["Preferred date",b.date],["Preferred time",b.time],
    ["Customer notes",b.notes],
    ["Created at",b.created_at?new Date(b.created_at).toLocaleString("en-PH"):""]
  ];

  return <main className="admin">
    <div className="admin-nav">
      <strong>MALTO ADMIN</strong>
      <span style={{display:"flex",gap:18,alignItems:"center"}}>
        <span className="small" style={{color:"#DDDCD6"}}>{userEmail}</span>
        <span>Dashboard</span>
        <button className="small" onClick={signOut} style={{background:"none",border:0,color:"#DDDCD6",cursor:"pointer",font:"inherit"}}>Sign out</button>
      </span>
    </div>

    <div className="admin-body">
      <div className="eyebrow">DASHBOARD</div>
      <h1>Operations overview.</h1>

      {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
      {notice&&<div className="notice">{notice}</div>}

      <div className="kpis">{kpis.map(([a,b])=><div className="kpi" key={a as string}><span className="small">{a as string}</span><strong>{b as number}</strong></div>)}</div>

      <div className="table">
        {loading?<p className="text" style={{padding:20}}>Loading bookings…</p>:rows.length===0?<p className="text" style={{padding:20}}>No bookings yet. Submissions from the booking form will appear here.</p>:
        <table>
          <thead><tr><th>Request ID</th><th>Status</th><th>Service</th><th>Price</th></tr></thead>
          <tbody>
            {rows.map(b=><Fragment key={b.id}>
              <tr onClick={()=>toggleRow(b)} style={{cursor:"pointer",background:expanded===b.id?"#E5EBE6":"transparent"}}>
                <td>{b.booking_ref||String(b.id).slice(0,8)}</td>
                <td onClick={e=>e.stopPropagation()}>
                  <select value={STATUSES.includes(b.status)?b.status:"New Request"} disabled={busy===b.id} onChange={e=>updateStatus(b.id,e.target.value)}>
                    {(STATUSES.includes(b.status)?STATUSES:[b.status,...STATUSES]).map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>{b.services||"—"}</td>
                <td>{formatPrice(b.price)}</td>
              </tr>
              {expanded===b.id&&<tr>
                <td colSpan={4}>
                  <div className="estimate">
                    <div className="form-grid">
                      {detailRows(b).map(([k,v])=><div className="field" key={k}><label>{k}</label><span className="text">{v?String(v):"—"}</span></div>)}
                      <div className="field">
                        <label>Final price</label>
                        <div style={{display:"flex",gap:8}}>
                          <input inputMode="decimal" placeholder="e.g. 2800" value={priceDraft[b.id]??(b.price??"") } onChange={e=>setPriceDraft(p=>({...p,[b.id]:e.target.value}))}/>
                          <button className="btn" disabled={busy===b.id} style={{minHeight:44,opacity:busy===b.id?.6:1}} onClick={()=>updatePrice(b.id)}>SAVE</button>
                        </div>
                      </div>
                      <div className="field">
                        <label>Photo</label>
                        {b.photo_path?(photos[b.id]?<img src={photos[b.id]} alt="Booking photo" style={{width:"100%",maxHeight:260,objectFit:"cover",border:"1px solid #DDDCD6"}}/>:<span className="text">Loading photo…</span>):<span className="text">No photo uploaded.</span>}
                      </div>
                    </div>
                    <p className="small" style={{marginTop:14}}>Booking reference: {b.booking_ref||"—"} · Created: {b.created_at?new Date(b.created_at).toLocaleString("en-PH"):"—"}</p>
                  </div>
                </td>
              </tr>}
            </Fragment>)}
          </tbody>
        </table>}
      </div>

      <div className="section" style={{border:0,paddingBottom:0}}>
        <h2>Admin structure</h2>
        <p className="text">Bookings · Calendar · Customers · Services · Pricing Rules · Team · Settings</p>
      </div>
    </div>
  </main>;
}
