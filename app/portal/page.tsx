"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

/** The columns my_assignments() is allowed to return. admin_notes is absent
 *  by design and never arrives over the wire. */
type Assignment={
  assignment_id:string; status:string; note:string; member_note:string;
  assigned_at:string; responded_at:string|null; done_at:string|null;
  booking_id:string; booking_ref:string|null; names:string|null; phone:string|null;
  email:string|null; services:string|null; date:string|null; time:string|null;
  adress:string|null; city:string|null; province:string|null; landmark:string|null;
  access:string|null; property:string|null; sqm:string|null;
  bedrooms:number|null; bathrooms:number|null; areas:string|null;
  condition:string|null; scope_notes:string|null; materials:string|null;
  price:number|null; photo_path:string|null; booking_status:string; booking_created_at:string;
};
type Me={ id:string; name:string; role:string; email:string; phone:string;
  available:boolean; unavailable_note:string; portal_status:string; active:boolean };

const fmtDate=(s?:string|null)=>{
  if(!s) return "—";
  const d=new Date(`${String(s).slice(0,10)}T00:00:00`);
  if(Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("en-PH",{weekday:"short",month:"short",day:"numeric",year:"numeric"});
};
const fmtWhen=(s?:string|null)=>{
  if(!s) return "—";
  const d=new Date(s);
  if(Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
};
const money=(n:number|null)=>n===null||n===undefined?"—":`₱${Number(n).toLocaleString("en-PH")}`;

const NEXT:Record<string,{to:string;label:string}[]>={
  pending:[
    {to:"accepted",label:"ACCEPT JOB"},
    {to:"declined",label:"DECLINE"},
  ],
  accepted:[
    {to:"on_the_way",label:"ON THE WAY"},
    {to:"declined",label:"CANNOT MAKE IT"},
  ],
  on_the_way:[
    {to:"done",label:"MARK AS DONE"},
  ],
  done:[], declined:[], cancelled:[],
};

const STATUS_LABEL:Record<string,string>={
  pending:"Waiting for you", accepted:"Accepted", declined:"Declined",
  on_the_way:"On the way", done:"Done", cancelled:"Cancelled",
};

export default function PortalHome(){
  const router=useRouter();
  const [me,setMe]=useState<Me|null>(null);
  const [rows,setRows]=useState<Assignment[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [open,setOpen]=useState<string|null>(null);
  const [photos,setPhotos]=useState<Record<string,string>>({});
  const [noteDraft,setNoteDraft]=useState<Record<string,string>>({});

  const flash=(m:string)=>{ setNotice(m); setTimeout(()=>setNotice(null),3200); };

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const supabase=createClient();
      const {data:{user}}=await supabase.auth.getUser();
      if(!user){ router.replace("/portal/login"); return; }

      // Own row only: RLS on team_members permits exactly this.
      const {data:mine,error:mErr}=await supabase
        .from("team_members")
        .select("id,name,role,email,phone,available,unavailable_note,portal_status,active")
        .eq("user_id",user.id)
        .limit(1)
        .maybeSingle();
      if(mErr) throw mErr;
      if(!mine){ router.replace("/portal/login"); return; }
      setMe(mine as Me);

      if((mine as any).portal_status!=="approved"){ setLoading(false); return; }

      // The only path to booking data. No bookings policy is granted to members.
      const {data:list,error:aErr}=await supabase.rpc("my_assignments");
      if(aErr) throw aErr;
      setRows((list as Assignment[])||[]);
    }catch(e:any){ setError(e?.message||"Could not load your jobs."); }
    finally{ setLoading(false); }
  },[router]);

  useEffect(()=>{ load(); },[load]);

  const respond=async(id:string,status:string)=>{
    if(busy) return;
    setBusy(id); setError(null);
    try{
      const res=await fetch("/api/portal/assignment",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({assignment_id:id,status,member_note:noteDraft[id]})
      });
      const j=await res.json().catch(()=>({} as any));
      if(!res.ok) throw new Error(j.error||"Could not update that job.");
      flash(status==="accepted"?"Job accepted. The MALTO team has been notified."
          :status==="on_the_way"?"Marked as on the way."
          :status==="done"?"Nice work. Job closed."
          :"Job declined.");
      await load();
    }catch(err:any){ setError(err?.message||"Could not update that job."); }
    finally{ setBusy(null); }
  };

  const saveAvailability=async(patch:{available:boolean;unavailable_note:string})=>{
    if(busy) return;
    setBusy("me"); setError(null);
    try{
      // Only these two columns are member-editable; a trigger blocks the rest.
      const {error:err}=await createClient().from("team_members").update(patch).eq("user_id",(me as any)?.id);
      if(err) throw err;
      await load();
      flash("Availability updated.");
    }catch(err:any){ setError(err?.message||"Could not update your availability."); }
    finally{ setBusy(null); }
  };

  const loadPhoto=async(bookingId:string)=>{
    if(photos[bookingId]) return;
    try{
      const res=await fetch("/api/portal/photo",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({booking_id:bookingId})
      });
      const j=await res.json().catch(()=>({} as any));
      if(res.ok&&j.url) setPhotos(p=>({...p,[bookingId]:j.url}));
    }catch{ /* a missing photo is not worth an error banner */ }
  };

  const signOut=async()=>{
    try{ await createClient().auth.signOut(); }catch{ /* ignore */ }
    router.replace("/portal/login");
    router.refresh();
  };

  // A cancelled booking overrides the assignment: the admin withdrew the job,
  // so the member must not be prompted to accept it.
  const eff=(r:Assignment)=>r.booking_status==="Cancelled"?"cancelled":r.status;

  const {active,upcoming,history}=useMemo(()=>{
    const isOpen=(r:Assignment)=>{
      const s=eff(r);
      return s==="pending"||s==="accepted"||s==="on_the_way";
    };
    return {
      active:rows.filter(r=>isOpen(r)),
      upcoming:rows.filter(r=>!isOpen(r)&&eff(r)!=="cancelled"),
      history:rows.filter(r=>eff(r)==="done"||eff(r)==="declined"||eff(r)==="cancelled"),
    };
  },[rows]);

  if(loading){
    return <main className="portal-page"><div className="portal-shell"><p className="lead">Loading your jobs…</p></div></main>;
  }

  if(me&&me.portal_status!=="approved"){
    return <main className="portal-page">
      <header className="header"><div className="container nav">
        <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
        <button className="small" onClick={signOut} style={{background:"none",border:0,cursor:"pointer",font:"inherit"}}>Sign out</button>
      </div></header>
      <div className="portal-shell">
        <div className="eyebrow">TEAM PORTAL</div>
        <h2>Hi {me.name.split(" ")[0]}.</h2>
        <div className="notice">
          <strong>Your account is waiting for approval.</strong><br/>
          MALTO still needs to approve your account before any job shows up here. You do not need to do anything else.
        </div>
        <p className="small muted">Signed in as {me.email}</p>
      </div>
    </main>;
  }

  return <main className="portal-page">
    <header className="header"><div className="container nav">
      <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      <span style={{display:"flex",gap:16,alignItems:"center"}}>
        <span className="small muted">{me?.name}</span>
        <button className="small" onClick={signOut} style={{background:"none",border:0,cursor:"pointer",font:"inherit"}}>Sign out</button>
      </span>
    </div></header>

    <div className="portal-shell">
      {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
      {notice&&<div className="notice">{notice}</div>}

      <div className="eyebrow">TEAM PORTAL</div>
      <h2>Your jobs.</h2>

      {/* Availability: the single most useful thing for a part-time crew, and
          it is what stops the admin assigning you while you are unavailable. */}
      <div className="panel" style={{marginTop:22}}>
        <div className="panel-head"><strong>Your availability</strong>
          <span className={"badge"+(me?.available?" on":"")}>{me?.available?"Available":"Unavailable"}</span>
        </div>
        <p className="small muted" style={{margin:"0 0 14px"}}>
          {me?.available
            ? "You are listed as available and can be assigned jobs."
            : "You will not appear as assignable while this is on."}
        </p>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="btn" disabled={busy==="me"||me?.available} style={{minHeight:42,opacity:me?.available?.55:1}}
            onClick={()=>saveAvailability({available:true,unavailable_note:me?.unavailable_note||""})}>
            I&apos;m available
          </button>
          <button className="btn secondary" disabled={busy==="me"||!me?.available} style={{minHeight:42,opacity:!me?.available?.55:1}}
            onClick={()=>saveAvailability({available:false,unavailable_note:me?.unavailable_note||"Unavailable"})}>
            I&apos;m unavailable
          </button>
        </div>
        {me&&!me.available&&(
          <div className="field" style={{marginTop:14}}>
            <label>Reason (optional)</label>
            <input defaultValue={me.unavailable_note} placeholder="Sick, other job, etc."
              onBlur={e=>{ if(e.target.value!==me.unavailable_note) saveAvailability({available:false,unavailable_note:e.target.value}); }}/>
          </div>
        )}
      </div>

      {active.length===0&&upcoming.length===0&&
        <div className="panel"><p className="text" style={{margin:0}}>No jobs assigned to you yet. They will appear here as soon as MALTO assigns one.</p></div>}

      {[...active,...upcoming].map(r=>{
        const isOpen=open===r.assignment_id;
        const view=eff(r);
        const actions=NEXT[view]??[];
        const mapHref=r.adress
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([r.adress,r.city,r.province].filter(Boolean).join(", "))}`
          : "";
        return <div className="jobcard" key={r.assignment_id}>
          <div className="jobcard-top" onClick={()=>{ setOpen(isOpen?null:r.assignment_id); if(!isOpen) loadPhoto(r.booking_id); }}>
            <div style={{minWidth:0,flex:1}}>
              <div className="jobcard-ref">{r.booking_ref||"Job"}</div>
              <div className="jobcard-service">{r.services||"Cleaning"}</div>
              <div className="small muted">{fmtDate(r.date)}{r.time?` · ${r.time}`:""}</div>
            </div>
            <span className={"badge"+((view==="pending"||view==="accepted"||view==="on_the_way")?" on":"")}>
              {STATUS_LABEL[view]??view}
            </span>
          </div>

          {isOpen&&<div className="jobcard-body">
            {view==="cancelled"&&(
              <div className="notice" style={{margin:"0 0 18px",background:"#FBE9E7",color:"#8A2C1D"}}>
                This job was cancelled by MALTO. Nothing to do.
              </div>
            )}
            {r.note&&<div className="notice" style={{margin:"0 0 18px"}}><strong>Note from the team:</strong> {r.note}</div>}

            <div className="jobgrid">
              <div className="jobgrid-item">
                <span className="joblabel">Customer</span>
                <strong>{r.names||"—"}</strong>
                {r.phone&&<a className="joblink" href={`tel:${r.phone}`}>Call {r.phone}</a>}
                {r.email&&<a className="joblink" href={`mailto:${r.email}`}>Email {r.email}</a>}
              </div>
              <div className="jobgrid-item">
                <span className="joblabel">Address</span>
                <strong>{[r.adress,r.city,r.province].filter(Boolean).join(", ")||"—"}</strong>
                {r.landmark&&<span className="small muted">Landmark: {r.landmark}</span>}
                {mapHref&&<a className="joblink" href={mapHref} target="_blank" rel="noreferrer">Open in Maps</a>}
              </div>
              <div className="jobgrid-item">
                <span className="joblabel">Property</span>
                <strong>{r.property||"—"}</strong>
                <span className="small muted">
                  {r.sqm?`${r.sqm} sqm`:""}{r.bedrooms?` · ${r.bedrooms} bed`:""}{r.bathrooms?` · ${r.bathrooms} bath`:""}
                </span>
                {r.condition&&<span className="small muted">Condition: {r.condition}</span>}
              </div>
              <div className="jobgrid-item">
                <span className="joblabel">Scope</span>
                <strong>{r.areas||"—"}</strong>
                {r.materials&&<span className="small muted">Materials: {r.materials}</span>}
                {r.scope_notes&&<span className="small muted">{r.scope_notes}</span>}
              </div>
              {r.access&&<div className="jobgrid-item">
                <span className="joblabel">Access</span>
                <span className="small">{r.access}</span>
              </div>}
              {r.price!=null&&<div className="jobgrid-item">
                <span className="joblabel">Final price</span>
                <strong>{money(r.price)}</strong>
              </div>}
            </div>

            {photos[r.booking_id]&&(
              <img src={photos[r.booking_id]} alt="Customer photo of the property"
                className="jobphoto"/>
            )}

            <div className="field" style={{marginTop:18}}>
              <label>Your note (optional)</label>
              <input value={noteDraft[r.assignment_id]??r.member_note}
                onChange={e=>setNoteDraft(p=>({...p,[r.assignment_id]:e.target.value}))}
                placeholder="e.g. I will bring my own vacuum"/>
            </div>

            {actions.length>0&&(
              <div className="jobactions">
                {actions.map(a=>(
                  <button key={a.to}
                    className={"btn"+(a.to==="declined"?" secondary":"")}
                    disabled={busy===r.assignment_id}
                    style={{minHeight:46,opacity:busy===r.assignment_id?.6:1}}
                    onClick={()=>respond(r.assignment_id,a.to)}>
                    {busy===r.assignment_id?"SAVING…":a.label}
                  </button>
                ))}
              </div>
            )}

            <div className="small muted" style={{marginTop:14}}>
              Assigned {fmtWhen(r.assigned_at)}{r.responded_at?` · Answered ${fmtWhen(r.responded_at)}`:""}{r.done_at?` · Done ${fmtWhen(r.done_at)}`:""}
            </div>
          </div>}
        </div>;
      })}

      {history.length>0&&<>
        <div className="eyebrow" style={{marginTop:34}}>PAST JOBS</div>
        <div className="table">
          <table>
            <thead><tr><th>Ref</th><th>Service</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>{history.map(r=>(
              <tr key={r.assignment_id}>
                <td className="small">{r.booking_ref}</td>
                <td className="small">{r.services}</td>
                <td className="small">{fmtDate(r.date)}</td>
                <td className="small">{STATUS_LABEL[eff(r)]??eff(r)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  </main>;
}
