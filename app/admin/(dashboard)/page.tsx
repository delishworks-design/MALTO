"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const STATUSES=["New Request","Confirmed","In Progress","Completed","Cancelled"];
const PHOTO_BUCKET="booking-photos";
const ACTIVE=["Confirmed","In Progress"];

const pad=(n:number)=>String(n).padStart(2,"0");
const toISO=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const fmtDate=(s?:string|null)=>{
  if(!s) return "—";
  const d=new Date(`${s}T00:00:00`);
  if(Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
};

const timeAgo=(ts:number)=>{
  const s=Math.max(0,Math.floor((Date.now()-ts)/1000));
  if(s<45) return "just now";
  if(s<3600) return `${Math.floor(s/60)} min ago`;
  if(s<86400) return `${Math.floor(s/3600)} hr ago`;
  return `${Math.floor(s/86400)} day ago`;
};

function friendlyError(error:any){
  const msg=String(error?.message||"");
  if(error?.code==="42501"||/permission denied/i.test(msg))
    return "You do not have permission to do that.";
  if(error?.code==="42P01"||/does not exist/i.test(msg))
    return "The booking tables are not set up yet. Please run the migration SQL.";
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

export default function Bookings(){
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [userEmail,setUserEmail]=useState("");
  const [photos,setPhotos]=useState<Record<string,string>>({});
  const [priceDraft,setPriceDraft]=useState<Record<string,string>>({});
  const [noteDraft,setNoteDraft]=useState<Record<string,string>>({});
  const [lastUpdated,setLastUpdated]=useState<number>(0);
  const [,setTick]=useState(0);

  const [search,setSearch]=useState("");
  const [statusFilter,setStatusFilter]=useState<string>("All");
  const [quick,setQuick]=useState<string|null>(null);
  const [sort,setSort]=useState("new");

  const load=useCallback(async(silent=false)=>{
    if(!silent) setLoading(true);
    setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user){ return; }
      setUserEmail(user.email||"");
      const { data,error:err }=await supabase.from("bookings").select("*").order("created_at",{ascending:false});
      if(err) throw err;
      setRows(data||[]);
      setLastUpdated(Date.now());
    }catch(err:any){
      setError(friendlyError(err));
    }finally{
      if(!silent) setLoading(false);
    }
  },[]);

  useEffect(()=>{ load(); },[load]);

  useEffect(()=>{
    const id=setInterval(()=>setTick(x=>x+1),30000);
    return ()=>clearInterval(id);
  },[]);

  useEffect(()=>{
    const supabase=createClient();
    const channel=supabase.channel("admin-bookings");
    const refresh=()=>{ void load(true); };
    channel.on("postgres_changes",{event:"INSERT",schema:"public",table:"bookings"},refresh);
    channel.on("postgres_changes",{event:"UPDATE",schema:"public",table:"bookings"},refresh);
    channel.subscribe();
    return ()=>{ void supabase.removeChannel(channel); };
  },[load]);

  const kpis=useMemo(()=>{
    const today=toISO(new Date());
    const c=(s:string)=>rows.filter(r=>r.status===s).length;
    return [
      {key:"new",      label:"New Requests", value:c("New Request")},
      {key:"progress", label:"In Progress",  value:c("In Progress")},
      {key:"confirmed",label:"Confirmed",    value:c("Confirmed")},
      {key:"today",    label:"Today's Jobs", value:rows.filter(r=>r.date===today&&ACTIVE.includes(r.status)).length},
      {key:"upcoming", label:"Upcoming",     value:rows.filter(r=>r.date&&r.date>today&&ACTIVE.includes(r.status)).length},
    ];
  },[rows]);

  const statusCounts=useMemo(()=>STATUSES.map(s=>({s,n:rows.filter(r=>r.status===s).length})),[rows]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    let out=rows.filter(b=>{
      if(!q) return true;
      return [b.booking_ref,b.names,b.phone,b.email,b.city,b.services,b.adress,b.property]
        .some(v=>v&&String(v).toLowerCase().includes(q));
    });
    if(statusFilter!=="All") out=out.filter(r=>r.status===statusFilter);

    const today=toISO(new Date());
    if(quick==="new")       out=out.filter(r=>r.status==="New Request");
    else if(quick==="progress") out=out.filter(r=>r.status==="In Progress");
    else if(quick==="confirmed")out=out.filter(r=>r.status==="Confirmed");
    else if(quick==="today")    out=out.filter(r=>r.date===today&&ACTIVE.includes(r.status));
    else if(quick==="upcoming") out=out.filter(r=>r.date&&r.date>today&&ACTIVE.includes(r.status));

    const c=[...out];
    if(sort==="new")  c.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    if(sort==="old")  c.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    if(sort==="date") c.sort((a,b)=>String(a.date||"9999-99-99").localeCompare(String(b.date||"9999-99-99")));
    if(sort==="name") c.sort((a,b)=>String(a.names||"").localeCompare(String(b.names||"")));
    return c;
  },[rows,search,statusFilter,quick,sort]);

  const updateStatus=async(id:string,status:string)=>{
    if(busy) return;
    setBusy(id); setError(null);
    try{
      const supabase=createClient();
      const { error:err }=await supabase.from("bookings").update({status}).eq("id",id);
      if(err) throw err;
      setRows(rs=>rs.map(r=>r.id===id?{...r,status}:r));
      setNotice("Status updated.");
      setTimeout(()=>setNotice(null),2500);
    }catch(err:any){ setError(friendlyError(err)); }
    finally{ setBusy(null); }
  };

  const updatePrice=async(id:string)=>{
    if(busy) return;
    setBusy(id); setError(null);
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
    }catch(err:any){ setError(friendlyError(err)); }
    finally{ setBusy(null); }
  };

  const sendQuote=async(id:string)=>{
    if(busy) return;
    setBusy(id); setError(null);
    try{
      const raw=(priceDraft[id]?? "").trim();
      const value=raw===""?null:Number(raw.replace(/[^0-9.]/g,""));
      if(value===null||Number.isNaN(value)||value<=0)
        throw new Error("Enter the final price before sending a quote.");
      const res=await fetch("/api/send-quote",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({booking_id:id,price:value})
      });
      const j=await res.json().catch(()=>({} as any));
      if(!res.ok||!j.ok) throw new Error(j.error||"Could not send the quote.");
      setRows(rs=>rs.map(r=>r.id===id?{...r,price:value,status:j.status||r.status}:r));
      setNotice(`Quote sent to ${j.to}.`);
      setTimeout(()=>setNotice(null),4000);
    }catch(err:any){ setError(friendlyError(err)); }
    finally{ setBusy(null); }
  };

  const saveNote=async(id:string)=>{
    if(busy) return;
    setBusy(id); setError(null);
    try{
      const raw=(noteDraft[id]?? "").trim();
      const supabase=createClient();
      const { error:err }=await supabase.from("bookings").update({admin_notes:raw||null}).eq("id",id);
      if(err) throw err;
      setRows(rs=>rs.map(r=>r.id===id?{...r,admin_notes:raw||null}:r));
      setNotice("Note saved.");
      setTimeout(()=>setNotice(null),2500);
    }catch(err:any){ setError(friendlyError(err)); }
    finally{ setBusy(null); }
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

  const clearFilters=()=>{ setSearch(""); setStatusFilter("All"); setQuick(null); };

  const detailRows=(b:any):[string,any][]=>[
    ["Full name",b.names],["Mobile",b.phone],["Email",b.email],
    ["Property",b.property],["Approx. sqm",b.sqm],["Bedrooms",b.bedrooms],["Bathrooms",b.bathrooms],
    ["Areas",b.areas],["Condition",b.condition],["Scope notes",b.scope_notes],
    ["Materials",b.materials],
    ["Address",b.adress],["City / Municipality",b.city],["Province",b.province],
    ["Landmark",b.landmark],["Access instructions",b.access],
    ["Preferred date",fmtDate(b.date)],["Preferred time",b.time],
    ["Customer notes",b.notes],
    ["Created at",b.created_at?new Date(b.created_at).toLocaleString("en-PH"):""]
  ];

  const hasFilters=search.trim()!==""||statusFilter!=="All"||quick!==null;

  return <>
    {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
    {notice&&<div className="notice">{notice}</div>}

    <div className="eyebrow">DASHBOARD</div>
    <h1>Operations overview.</h1>

    <div className="kpis">
      {kpis.map(k=><div key={k.key}
        className={"kpi"+(quick===k.key?" active":"")}
        onClick={()=>setQuick(quick===k.key?null:k.key)}
        role="button" tabIndex={0}
        onKeyDown={e=>{if(e.key==="Enter") setQuick(quick===k.key?null:k.key);}}>
        <span className="small">{k.label}</span><strong>{k.value}</strong>
      </div>)}
    </div>

    <div className="pills">
      <button className={"pill"+(statusFilter==="All"&&!quick?" active":"")}
        onClick={()=>{setStatusFilter("All");setQuick(null);}}>
        All<span className="n">{rows.length}</span>
      </button>
      {statusCounts.map(({s,n})=><button key={s}
        className={"pill"+(statusFilter===s?" active":"")}
        onClick={()=>{setStatusFilter(statusFilter===s?"All":s);setQuick(null);}}>
        {s}<span className="n">{n}</span>
      </button>)}
    </div>

    <div className="toolbar">
      <input className="search" type="search" placeholder="Search name, ref, phone, email, city, service…"
        value={search} onChange={e=>setSearch(e.target.value)}/>
      <select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort bookings">
        <option value="new">Newest first</option>
        <option value="old">Oldest first</option>
        <option value="date">Appointment date</option>
        <option value="name">Customer A–Z</option>
      </select>
      <button className="btn" style={{minHeight:42}} onClick={()=>load()}>REFRESH</button>
      <span className="small muted">{lastUpdated?`Updated ${timeAgo(lastUpdated)}`:"—"}</span>
      <span className="small muted">
        Showing {filtered.length} of {rows.length} booking{rows.length===1?"":"s"}
        {hasFilters&&<button className="linkbtn" onClick={clearFilters}>Clear filters</button>}
      </span>
    </div>

    <div className="table">
      {loading?<p className="text" style={{padding:20}}>Loading bookings…</p>
      :rows.length===0?<p className="text" style={{padding:20}}>No bookings yet. Submissions from the booking form will appear here.</p>
      :filtered.length===0?<p className="text" style={{padding:20}}>No bookings match your search or filters. <button className="linkbtn" onClick={clearFilters}>Clear filters</button></p>
      :<table>
        <thead><tr>
          <th>Request ID</th><th>Customer</th><th>Date</th><th>Service</th><th>City</th><th>Status</th><th>Price</th>
        </tr></thead>
        <tbody>
          {filtered.map(b=><Fragment key={b.id}>
            <tr onClick={()=>toggleRow(b)} style={{cursor:"pointer",background:expanded===b.id?"#E5EBE6":"transparent"}}>
              <td>{b.booking_ref||String(b.id).slice(0,8)}</td>
              <td>{b.names||"—"}</td>
              <td>{fmtDate(b.date)}</td>
              <td>{b.services||"—"}</td>
              <td>{b.city||"—"}</td>
              <td onClick={e=>e.stopPropagation()}>
                <select value={STATUSES.includes(b.status)?b.status:"New Request"} disabled={busy===b.id}
                  onChange={e=>updateStatus(b.id,e.target.value)} aria-label="Status">
                  {(STATUSES.includes(b.status)?STATUSES:[b.status,...STATUSES]).map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>{formatPrice(b.price)}</td>
            </tr>
            {expanded===b.id&&<tr>
              <td colSpan={7}>
                <div className="estimate">
                  <div className="form-grid">
                    {detailRows(b).map(([k,v])=><div className="field" key={k}><label>{k}</label><span className="text">{v?String(v):"—"}</span></div>)}
                    <div className="field">
                      <label>Final price</label>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <input inputMode="decimal" placeholder="e.g. 2800"
                          value={priceDraft[b.id]??(b.price??"")}
                          onChange={e=>setPriceDraft(p=>({...p,[b.id]:e.target.value}))}/>
                        <button className="btn" disabled={busy===b.id} style={{minHeight:44,opacity:busy===b.id?.6:1}}
                          onClick={()=>updatePrice(b.id)}>SAVE</button>
                        <button className="btn secondary" disabled={busy===b.id} style={{minHeight:44,opacity:busy===b.id?.6:1}}
                          onClick={()=>sendQuote(b.id)}>SEND QUOTE</button>
                      </div>
                      <span className="small muted">“SEND QUOTE” saves the price, marks the booking Confirmed and emails the customer.</span>
                    </div>
                    <div className="field">
                      <label>Photo</label>
                      {b.photo_path?(photos[b.id]
                        ?<img src={photos[b.id]} alt="Booking photo" style={{width:"100%",maxHeight:260,objectFit:"cover",border:"1px solid #DDDCD6"}}/>
                        :<span className="text">Loading photo…</span>)
                        :<span className="text">No photo uploaded.</span>}
                    </div>
                    <div className="field full">
                      <label>Internal note (admin only — hindi nakikita ng customer)</label>
                      <textarea placeholder="Hal. Natawagan na, malapit ma-confirm…"
                        value={noteDraft[b.id]??(b.admin_notes??"")}
                        onChange={e=>setNoteDraft(p=>({...p,[b.id]:e.target.value}))}/>
                      <div style={{display:"flex",gap:8,marginTop:8}}>
                        <button className="btn" disabled={busy===b.id} style={{minHeight:40,opacity:busy===b.id?.6:1}}
                          onClick={()=>saveNote(b.id)}>SAVE NOTE</button>
                        <span className="small muted">{b.admin_notes?"May na-save na note.":"Walang note pa."}</span>
                      </div>
                    </div>
                  </div>
                  <p className="small" style={{marginTop:14}}>
                    Booking reference: {b.booking_ref||"—"} · Status: {b.status||"—"} · Created: {b.created_at?new Date(b.created_at).toLocaleString("en-PH"):"—"}
                  </p>
                </div>
              </td>
            </tr>}
          </Fragment>)}
        </tbody>
      </table>}
    </div>
  </>;
}
