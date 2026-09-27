"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const pad=(n:number)=>String(n).padStart(2,"0");
const dayISO=(y:number,m:number,d:number)=>`${y}-${pad(m+1)}-${pad(d)}`;
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const ACTIVE=["Confirmed","In Progress"];

const fmtDate=(s:string)=>{
  const d=new Date(`${s}T00:00:00`);
  if(Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
};

export default function Calendar(){
  const now=new Date();
  const [cursor,setCursor]=useState({y:now.getFullYear(),m:now.getMonth()});
  const [selected,setSelected]=useState<string>(dayISO(now.getFullYear(),now.getMonth(),now.getDate()));
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    setLoading(true); setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user) return;
      const { data,error:err }=await supabase.from("bookings").select("*");
      if(err) throw err;
      setRows(data||[]);
    }catch(e:any){ setError(e?.message||"Could not load bookings."); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ load(); },[load]);

  const byDate=useMemo(()=>{
    const map:Record<string,any[]>={};
    rows.forEach(r=>{ if(r.date){ (map[r.date]=map[r.date]||[]).push(r); } });
    return map;
  },[rows]);

  const cells=useMemo(()=>{
    const first=new Date(cursor.y,cursor.m,1).getDay();
    const total=new Date(cursor.y,cursor.m+1,0).getDate();
    const out:(number|null)[]=[];
    for(let i=0;i<first;i++) out.push(null);
    for(let d=1;d<=total;d++) out.push(d);
    while(out.length%7!==0) out.push(null);
    return out;
  },[cursor]);

  const monthCount=useMemo(()=>{
    const prefix=`${cursor.y}-${pad(cursor.m+1)}`;
    return rows.filter(r=>r.date&&r.date.startsWith(prefix)).length;
  },[rows,cursor]);

  const dayRows=(byDate[selected]||[]).slice().sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));

  const move=(delta:number)=>{
    setCursor(c=>{
      const d=new Date(c.y,c.m+delta,1);
      return {y:d.getFullYear(),m:d.getMonth()};
    });
  };

  const goToday=()=>{
    const d=new Date();
    setCursor({y:d.getFullYear(),m:d.getMonth()});
    setSelected(dayISO(d.getFullYear(),d.getMonth(),d.getDate()));
  };

  return <>
    {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
    <div className="eyebrow">CALENDAR</div>
    <h1>Schedule at a glance.</h1>
    <p className="small muted">Click an appointment date to see the bookings for that day. {loading?"":`${monthCount} booking${monthCount===1?"":"s"} this month.`}</p>

    <div className="cal">
      <div className="cal-bar">
        <button className="btn secondary" style={{minHeight:40,padding:"0 16px"}} onClick={()=>move(-1)} aria-label="Previous month">‹</button>
        <strong className="cal-title">{MONTHS[cursor.m]} {cursor.y}</strong>
        <button className="btn secondary" style={{minHeight:40,padding:"0 16px"}} onClick={()=>move(1)} aria-label="Next month">›</button>
        <button className="btn" style={{minHeight:40,padding:"0 16px"}} onClick={goToday}>TODAY</button>
      </div>

      <div className="cal-grid">
        {DOW.map(d=><div className="cal-dow" key={d}>{d}</div>)}
        {cells.map((d,i)=>{
          if(d===null) return <div className="cal-day empty" key={`e${i}`}/>;
          const iso=dayISO(cursor.y,cursor.m,d);
          const list=byDate[iso]||[];
          const activeCount=list.filter(r=>ACTIVE.includes(r.status)).length;
          return <div key={iso}
            className={"cal-day"+(list.length?" has":"")+(selected===iso?" sel":"")}
            onClick={()=>setSelected(iso)}>
            <span className="cal-num">{d}</span>
            {list.length>0&&<span className={"cal-count"+(activeCount?" live":"")}>{list.length}</span>}
          </div>;
        })}
      </div>
    </div>

    <div className="section-head" style={{marginTop:34,marginBottom:18}}>
      <div>
        <div className="eyebrow">SELECTED DAY</div>
        <h2 style={{marginTop:8}}>{fmtDate(selected)}</h2>
      </div>
      <p className="small muted">{dayRows.length?`${dayRows.length} booking${dayRows.length===1?"":"s"}`:"No appointment on this day."}</p>
    </div>

    <div className="table">
      {loading?<p className="text" style={{padding:20}}>Loading…</p>
      :dayRows.length===0?<p className="text" style={{padding:20}}>No bookings this week. Pick another day in the calendar.</p>
      :<table>
        <thead><tr><th>Request ID</th><th>Customer</th><th>Time</th><th>Service</th><th>City</th><th>Status</th></tr></thead>
        <tbody>{dayRows.map(b=><tr key={b.id}>
          <td>{b.booking_ref||String(b.id).slice(0,8)}</td>
          <td>{b.names||"—"}</td>
          <td>{b.time||"—"}</td>
          <td>{b.services||"—"}</td>
          <td>{b.city||"—"}</td>
          <td>{b.status||"—"}</td>
        </tr>)}</tbody>
      </table>}
    </div>
  </>;
}
