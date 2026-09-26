"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type FAQ={q:string;a:string};
type Field={key:string;label:string;type?:"text"|"textarea"};

const GROUPS:{title:string;hint:string;fields:Field[]}[]=[
  {title:"Hero & branding",hint:"Lumalabas sa pinaka-itaas ng homepage at sa footer.",fields:[
    {key:"hero_headline",label:"Hero headline"},
    {key:"hero_lead",label:"Hero subtitle",type:"textarea"},
    {key:"hero_note",label:"Hero side note",type:"textarea"},
    {key:"footer_tagline",label:"Footer tagline"},
  ]},
  {title:"Buttons (CTA)",hint:"Label ng mga button sa buong website.",fields:[
    {key:"cta_primary",label:"Primary button"},
    {key:"cta_secondary",label:"Secondary button"},
    {key:"cta_estimate",label:"Estimate button (pricing page)"},
  ]},
  {title:"Section copy",hint:"Mga heading at paliwanag sa homepage at mga pahina.",fields:[
    {key:"services_heading",label:"Services heading"},
    {key:"services_lead",label:"Services paragraph",type:"textarea"},
    {key:"pricing_heading",label:"Pricing heading"},
    {key:"pricing_lead",label:"Pricing paragraph",type:"textarea"},
    {key:"pricing_starting_from",label:"Starting price text"},
    {key:"pricing_disclaimer",label:"Pricing disclaimer",type:"textarea"},
    {key:"about_title",label:"About heading"},
    {key:"about_body",label:"About paragraph",type:"textarea"},
    {key:"contact_heading",label:"Contact heading"},
    {key:"contact_lead",label:"Contact paragraph",type:"textarea"},
    {key:"faq_heading",label:"FAQ heading"},
  ]},
  {title:"Contact details",hint:"Papalitan ang walang laman na /contact at footer.",fields:[
    {key:"contact_phone",label:"Phone"},
    {key:"contact_email",label:"Email"},
    {key:"contact_address",label:"Address"},
    {key:"contact_hours",label:"Business hours"},
  ]},
  {title:"SEO",hint:"Lumalabas sa Google at sa social share.",fields:[
    {key:"seo_title",label:"Meta title"},
    {key:"seo_description",label:"Meta description",type:"textarea"},
  ]},
];

export default function SettingsAdmin(){
  const [settings,setSettings]=useState<Record<string,string>>({});
  const [faq,setFaq]=useState<FAQ[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);

  const [pw1,setPw1]=useState(""); const [pw2,setPw2]=useState("");

  const [email,setEmail]=useState({smtp_host:"",smtp_port:"465",smtp_secure:true,smtp_user:"",from_name:"",from_email:"",reply_to:""});
  const [hasPass,setHasPass]=useState(false);
  const [newPass,setNewPass]=useState("");

  // Undelivered emails from the outbox, so a booking notification that could
  // not be sent is visible here instead of disappearing.
  const [failedMails,setFailedMails]=useState<{id:string;kind:string;to_email:string;attempts:number;last_error:string|null;created_at:string}[]>([]);
  const [retryingMail,setRetryingMail]=useState(false);

  const loadFailedMail=useCallback(async()=>{
    try{
      const supabase=createClient();
      const {data,error:err}=await supabase
        .from("email_outbox")
        .select("id,kind,to_email,attempts,last_error,created_at")
        .eq("status","failed")
        .order("created_at",{ascending:false})
        .limit(20);
      if(err) throw err;
      setFailedMails((data as any[])||[]);
    }catch{
      setFailedMails([]);
    }
  },[]);

  useEffect(()=>{ loadFailedMail(); },[loadFailedMail]);

  const retryFailedMail=async()=>{
    if(retryingMail) return;
    setRetryingMail(true);
    try{
      await fetch("/api/admin/retry-emails",{method:"POST"});
      await loadFailedMail();
    }finally{
      setRetryingMail(false);
    }
  };

  const flash=(m:string)=>{ setNotice(m); setTimeout(()=>setNotice(null),3000); };

  const load=useCallback(async()=>{
    setLoading(true); setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user) return;
      const [{data:ss,error:e1},{data:es,error:e2}]=await Promise.all([
        supabase.from("site_settings").select("*"),
        supabase.from("email_settings").select("*").limit(1)
      ]);
      if(e1) throw e1; if(e2) throw e2;
      const map:Record<string,string>={};
      (ss||[]).forEach((r:any)=>{ map[r.key]=r.value; });
      setSettings(map);
      try{ setFaq(JSON.parse(map.faq_items||"[]")); }catch{ setFaq([]); }
      if(es&&es[0]) setEmail({
        smtp_host:es[0].smtp_host,smtp_port:String(es[0].smtp_port),smtp_secure:!!es[0].smtp_secure,
        smtp_user:es[0].smtp_user,from_name:es[0].from_name,from_email:es[0].from_email,reply_to:es[0].reply_to
      });
      try{
        const r=await fetch("/api/admin/email-password",{method:"GET"});
        const j=await r.json();
        setHasPass(!!j.hasPassword);
      }catch{ /* route not ready */ }
    }catch(e:any){ setError(e?.message||"Could not load settings."); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ load(); },[load]);

  const saveWebsite=async()=>{
    if(busy) return;
    setBusy("site"); setError(null);
    try{
      const supabase=createClient();
      const entries=GROUPS.flatMap(g=>g.fields.map(f=>({key:f.key,value:settings[f.key]??"",is_public:true})));
      entries.push({key:"faq_items",value:JSON.stringify(faq.filter(x=>x.q.trim()||x.a.trim())),is_public:true});
      const {error:err}=await supabase.from("site_settings").upsert(entries,{onConflict:"key"});
      if(err) throw err;
      flash("Website configuration saved. (Aabutin ng hanggang 1 minuto bago lumitaw sa website — ISR.)");
    }catch(e:any){ setError(e?.message||"Could not save website settings."); }
    finally{ setBusy(null); }
  };

  const changePassword=async()=>{
    if(busy) return;
    setBusy("pw"); setError(null);
    try{
      if(pw1.length<6) throw new Error("Password must be at least 6 characters.");
      if(pw1!==pw2) throw new Error("Passwords do not match.");
      const supabase=createClient();
      const {error:err}=await supabase.auth.updateUser({password:pw1});
      if(err) throw err;
      setPw1(""); setPw2("");
      flash("Password updated.");
    }catch(e:any){ setError(e?.message||"Could not change password."); }
    finally{ setBusy(null); }
  };

  const saveEmail=async()=>{
    if(busy) return;
    setBusy("mail"); setError(null);
    try{
      const supabase=createClient();
      const {error:err}=await supabase.from("email_settings").upsert({
        id:1,
        smtp_host:email.smtp_host.trim(),
        smtp_port:Number(email.smtp_port)||465,
        smtp_secure:email.smtp_secure,
        smtp_user:email.smtp_user.trim(),
        from_name:email.from_name.trim(),
        from_email:email.from_email.trim(),
        reply_to:email.reply_to.trim()
      },{onConflict:"id"});
      if(err) throw err;
      flash("SMTP settings saved.");
    }catch(e:any){ setError(e?.message||"Could not save SMTP settings."); }
    finally{ setBusy(null); }
  };

  const saveEmailPassword=async()=>{
    if(busy) return;
    setBusy("pass"); setError(null);
    try{
      if(!newPass) throw new Error("Ilagay ang bagong SMTP password.");
      const res=await fetch("/api/admin/email-password",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:newPass})
      });
      const j=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(j.error||"Could not save SMTP password.");
      setNewPass("");
      setHasPass(true);
      flash("SMTP password saved (encrypted).");
    }catch(e:any){ setError(e?.message||"Could not save SMTP password."); }
    finally{ setBusy(null); }
  };

  const testEmail=async()=>{
    if(busy) return;
    setBusy("test"); setError(null);
    try{
      const res=await fetch("/api/admin/email-test",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const j=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(j.error||j.detail||"Test email failed.");
      flash(`Test email sent to ${j.to}.`);
    }catch(e:any){ setError(e?.message||"Test email failed."); }
    finally{ setBusy(null); }
  };

  if(loading) return <><div className="eyebrow">SETTINGS</div><h1>Control centre.</h1><p className="text">Loading settings…</p></>;

  return <>
    {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
    {notice&&<div className="notice">{notice}</div>}

    <div className="eyebrow">SETTINGS</div>
    <h1>Control centre.</h1>

    {/* -------- ACCOUNT -------- */}
    <div className="panel">
      <div className="panel-head"><strong>Account</strong><span className="small muted">Palitan ang password ng admin login</span></div>
      <div className="form-grid">
        <div className="field"><label>New password</label>
          <input type="password" value={pw1} onChange={e=>setPw1(e.target.value)} autoComplete="new-password"/></div>
        <div className="field"><label>Repeat new password</label>
          <input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} autoComplete="new-password"/></div>
        <div className="field full" style={{justifyContent:"flex-end"}}>
          <button className="btn" disabled={busy==="pw"} style={{minHeight:46,opacity:busy==="pw"?.6:1}} onClick={changePassword}>
            {busy==="pw"?"SAVING…":"CHANGE PASSWORD"}
          </button>
        </div>
      </div>
    </div>

    {/* -------- EMAIL / SMTP -------- */}
    <div className="panel">
      <div className="panel-head"><strong>Email (SMTP)</strong><span className="small muted">Ginagamit ng booking confirmation at admin alert</span></div>
      <div className="form-grid">
        <div className="field"><label>SMTP host</label>
          <input value={email.smtp_host} onChange={e=>setEmail(s=>({...s,smtp_host:e.target.value}))} placeholder="smtp.gmail.com"/></div>
        <div className="field"><label>SMTP port</label>
          <input type="number" value={email.smtp_port} onChange={e=>setEmail(s=>({...s,smtp_port:e.target.value}))}/></div>
        <div className="field"><label>Username (Gmail address)</label>
          <input value={email.smtp_user} onChange={e=>setEmail(s=>({...s,smtp_user:e.target.value}))} placeholder="you@gmail.com"/></div>
        <div className="field"><label>Secure (SSL / port 465)</label>
          <select value={email.smtp_secure?"1":"0"} onChange={e=>setEmail(s=>({...s,smtp_secure:e.target.value==="1"}))}>
            <option value="1">Yes</option><option value="0">No (STARTTLS)</option>
          </select></div>
        <div className="field"><label>From name</label>
          <input value={email.from_name} onChange={e=>setEmail(s=>({...s,from_name:e.target.value}))} placeholder="MALTO Cleaning Services"/></div>
        <div className="field"><label>From email</label>
          <input value={email.from_email} onChange={e=>setEmail(s=>({...s,from_email:e.target.value}))} placeholder="bookings@example.com"/></div>
        <div className="field full"><label>Reply-To (saan sasagutin ng client)</label>
          <input value={email.reply_to} onChange={e=>setEmail(s=>({...s,reply_to:e.target.value}))} placeholder="you@gmail.com"/></div>

        <div className="field full"><label>SMTP password {hasPass&&<span className="small muted">(may nakaimbak na — i-type lang kung papalitan)</span>}</label>
          <input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)}
            placeholder={hasPass?"•••••••• (nakaimbak, naka-encrypt)":"Wala pang password — i-type ito"}
            autoComplete="new-password"/></div>

        <div className="field full">
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button className="btn" disabled={busy==="mail"} style={{minHeight:46,opacity:busy==="mail"?.6:1}} onClick={saveEmail}>
              {busy==="mail"?"SAVING…":"SAVE SMTP SETTINGS"}
            </button>
            <button className="btn secondary" style={{minHeight:46}} disabled={busy==="pass"||!newPass} onClick={saveEmailPassword}>
              {busy==="pass"?"SAVING…":"SAVE PASSWORD"}
            </button>
            <button className="btn secondary" style={{minHeight:46}} disabled={busy==="test"} onClick={testEmail}>
              {busy==="test"?"SENDING…":"SEND TEST EMAIL"}
            </button>
          </div>
          <p className="small muted" style={{marginTop:10}}>
            Gmail: kailangan ng <strong>App Password</strong> (16 characters) — hindi ang normal na password.
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="linkbtn">Gumawa ng App Password</a>
          </p>
        </div>
      </div>
    </div>

    {/* -------- EMAIL DELIVERY -------- */}
    <div className="panel">
      <div className="panel-head"><strong>Email delivery</strong><span className="small muted">Naiire-record ang bawat email bago ipadala, at sinusubukan muli hanggang matagumpay</span></div>
      {failedMails.length===0
        ? <p className="small muted" style={{margin:0}}>Walang email na hindi naipadala. Lahat ay na-send.</p>
        : <>
          <p className="small" style={{margin:"0 0 14px"}}>
            {failedMails.length} email{failedMails.length===1?"":"s"} na hindi naipadala. Automatic retry pa rin ang tumatakbo bawat 5 minuto.
          </p>
          <div className="table" style={{marginTop:0}}>
            <table>
              <thead><tr><th>Uri</th><th>Type</th><th>Saan</th><th>Attempts</th><th>Error</th><th>Nailan</th></tr></thead>
              <tbody>{failedMails.map(m=>
                <tr key={m.id}>
                  <td className="small">{m.created_at?new Date(m.created_at).toLocaleString("en-PH"):"—"}</td>
                  <td className="small">{m.kind}</td>
                  <td className="small">{m.to_email||"(admin inbox)"}</td>
                  <td className="small">{m.attempts}/5</td>
                  <td className="small" style={{color:"#8A2C1D"}}>{m.last_error||"—"}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <button className="btn secondary" style={{marginTop:14,minHeight:42}} disabled={retryingMail} onClick={retryFailedMail}>
            {retryingMail?"RETRYING…":"RETRY ALL NOW"}
          </button>
        </>}
    </div>

    {/* -------- WEBSITE CONFIGURATION -------- */}
    <div className="panel">
      <div className="panel-head"><strong>Website configuration</strong><span className="small muted">Lumalabas sa buong public website</span></div>

      {GROUPS.map(g=><div key={g.title} style={{marginBottom:26}}>
        <div className="eyebrow" style={{marginBottom:6}}>{g.title}</div>
        <p className="small muted" style={{margin:"0 0 12px"}}>{g.hint}</p>
        <div className="form-grid">
          {g.fields.map(f=><div className={"field"+(f.type==="textarea"?" full":"")} key={f.key}>
            <label>{f.label}</label>
            {f.type==="textarea"
              ?<textarea value={settings[f.key]??""} onChange={e=>setSettings(s=>({...s,[f.key]:e.target.value}))}/>
              :<input value={settings[f.key]??""} onChange={e=>setSettings(s=>({...s,[f.key]:e.target.value}))}/>}
          </div>)}
        </div>
      </div>)}

      <div className="eyebrow" style={{marginBottom:6}}>FAQ</div>
      <p className="small muted" style={{margin:"0 0 12px"}}>Lumalabas sa homepage at sa /faq.</p>
      <div className="faqedit">
        {faq.map((f,i)=><div className="faqrow" key={i}>
          <input value={f.q} placeholder="Tanong" onChange={e=>setFaq(l=>l.map((x,j)=>j===i?{...x,q:e.target.value}:x))}/>
          <input value={f.a} placeholder="Sagot" onChange={e=>setFaq(l=>l.map((x,j)=>j===i?{...x,a:e.target.value}:x))}/>
          <button className="btn secondary" style={{minHeight:40,padding:"0 14px"}} onClick={()=>setFaq(l=>l.filter((_,j)=>j!==i))}>×</button>
        </div>)}
        <button className="btn secondary" style={{minHeight:42}} onClick={()=>setFaq(l=>[...l,{q:"",a:""}])}>+ ADD QUESTION</button>
      </div>

      <div style={{marginTop:24}}>
        <button className="btn" disabled={busy==="site"} style={{minHeight:48,opacity:busy==="site"?.6:1}} onClick={saveWebsite}>
          {busy==="site"?"SAVING…":"SAVE WEBSITE CONFIGURATION"}
        </button>
      </div>
    </div>
  </>;
}
