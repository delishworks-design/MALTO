"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type FAQ={q:string;a:string};

/** Kept in step with isValidEmail() in lib/email.ts, so the form rejects the
 *  same shapes the server would have to fall back on. */
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
type Field={key:string;label:string;type?:"text"|"textarea"};

const GROUPS:{title:string;hint:string;fields:Field[]}[]=[
  {title:"Hero & branding",hint:"Lumalabas sa pinaka-itaas ng homepage at sa footer.",fields:[
    {key:"hero_headline",label:"Hero headline"},
    {key:"hero_lead",label:"Hero subtitle",type:"textarea"},
    {key:"hero_note",label:"Hero side note",type:"textarea"},
    {key:"footer_tagline",label:"Footer tagline"},
  ]},
  {title:"Buttons (CTA)",hint:"Button labels used across the website.",fields:[
    {key:"cta_primary",label:"Primary button"},
    {key:"cta_secondary",label:"Secondary button"},
    {key:"cta_estimate",label:"Estimate button (pricing page)"},
  ]},
  {title:"Section copy",hint:"Headings and explanations on the homepage and pages.",fields:[
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
  {title:"Contact details",hint:"Fills in the empty /contact page and the footer.",fields:[
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

  // Recurring discounts drive both the client estimate and the admin's
  // suggested price, so they are editable here rather than in code.
  const [recurring,setRecurring]=useState<{frequency:string;label:string;client_label:string;discount_pct:string;sort_order:number}[]>([]);
  const [savingRec,setSavingRec]=useState(false);

  const loadRecurring=useCallback(async()=>{
    try{
      const supabase=createClient();
      const {data,error:err}=await supabase
        .from("recurring_discounts").select("*").order("sort_order");
      if(err) throw err;
      setRecurring((data as any[]||[]).map(r=>({...r,discount_pct:String(r.discount_pct)})));
    }catch{ setRecurring([]); }
  },[]);

  useEffect(()=>{ loadRecurring(); },[loadRecurring]);

  const saveRecurring=async()=>{
    if(savingRec) return;
    setSavingRec(true); setError(null);
    try{
      const supabase=createClient();
      for(const r of recurring){
        const pct=Number(r.discount_pct);
        if(!Number.isFinite(pct)||pct<0||pct>100)
          throw new Error(`${r.label}: the discount must be between 0 and 100.`);
        const {error:err}=await supabase.from("recurring_discounts")
          .update({discount_pct:pct}).eq("frequency",r.frequency);
        if(err) throw err;
      }
      flash("Recurring discounts saved.");
    }catch(e:any){ setError(e?.message||"Could not save the discounts."); }
    finally{ setSavingRec(false); }
  };

  // Outbox history so a delivered message can be told apart from one that
  // never arrived. Failures alone were not enough to debug a missing email.
  const [mailLog,setMailLog]=useState<{id:string;kind:string;to_email:string;status:string;attempts:number;last_error:string|null;provider_response:string|null;created_at:string;sent_at:string|null}[]>([]);
  const [retryingMail,setRetryingMail]=useState(false);

  const loadMailLog=useCallback(async()=>{
    try{
      const supabase=createClient();
      const {data,error:err}=await supabase
        .from("email_outbox")
        .select("id,kind,to_email,status,attempts,last_error,provider_response,created_at,sent_at")
        .order("created_at",{ascending:false})
        .limit(20);
      if(err) throw err;
      setMailLog((data as any[])||[]);
    }catch{
      setMailLog([]);
    }
  },[]);

  useEffect(()=>{ loadMailLog(); },[loadMailLog]);

  const retryFailedMail=async()=>{
    if(retryingMail) return;
    setRetryingMail(true);
    try{
      await fetch("/api/admin/retry-emails",{method:"POST"});
      await loadMailLog();
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
      // Catch a mistyped address here rather than discovering it later as a
      // booking alert that quietly went nowhere. A missing @ still forms a real
      // domain name, so this is exactly the case that is easy to miss by eye.
      const smtpUser=email.smtp_user.trim();
      const fromEmail=email.from_email.trim();
      const replyTo=email.reply_to.trim();
      const bad=(label:string,value:string)=>{
        throw new Error(`${label} is not a valid email address: "${value}". It must look like name@gmail.com — check for a missing @ or a typo in the domain.`);
      };
      if(smtpUser&&!EMAIL_RE.test(smtpUser)) bad("SMTP username",smtpUser);
      if(fromEmail&&!EMAIL_RE.test(fromEmail)) bad("From email",fromEmail);
      if(replyTo&&!EMAIL_RE.test(replyTo)) bad("Reply-To",replyTo);

      const supabase=createClient();
      const {error:err}=await supabase.from("email_settings").upsert({
        id:1,
        smtp_host:email.smtp_host.trim(),
        smtp_port:Number(email.smtp_port)||465,
        smtp_secure:email.smtp_secure,
        smtp_user:smtpUser,
        from_name:email.from_name.trim(),
        from_email:fromEmail,
        reply_to:replyTo
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
      if(!newPass) throw new Error("Enter the new SMTP password.");
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
      <div className="panel-head"><strong>Account</strong><span className="small muted">Change the admin login password</span></div>
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

        <div className="field full"><label>SMTP password {hasPass&&<span className="small muted">(one is stored, only type here to replace it)</span>}</label>
          <input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)}
            placeholder={hasPass?"•••••••• (stored, encrypted)":"No password yet, type one here"}
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
            Gmail needs an <strong>App Password</strong> (16 characters), not your normal password.
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="linkbtn">Gumawa ng App Password</a>
          </p>
        </div>
      </div>
    </div>

    {/* -------- EMAIL DELIVERY -------- */}
    <div className="panel">
      <div className="panel-head"><strong>Email delivery</strong><span className="small muted">Every email is recorded before it is sent, and retried until it goes out</span></div>

      {(()=>{
        const fromDiffers=email.from_email.trim()&&email.smtp_user.trim()
          &&email.from_email.trim().toLowerCase()!==email.smtp_user.trim().toLowerCase();
        const failed=mailLog.filter(m=>m.status==="failed");
        const shown=mailLog.slice(0,12);
        return <>
          {fromDiffers&&
            <div className="notice" style={{background:"#FDF6E4",color:"#6B4E14",border:"1px solid #E0B44A"}}>
              <strong>Heads up:</strong> the From address is not the same as the SMTP username. Gmail only guarantees inbox
              delivery when it authenticates as the address it is sending from — if the From is a different account,
              messages can be filtered into spam. This is fine if the From is an alias you have verified under
              “Send mail as” on the SMTP account.
            </div>}
          {failed.length>0&&
            <p className="small" style={{margin:"0 0 14px"}}>
              {failed.length} email{failed.length===1?"":"s"} could not be sent. Automatic retry is still running every 5 minutes.
            </p>}
          {shown.length===0
            ? <p className="small muted" style={{margin:0}}>Wala pang email na ipinadala.</p>
            : <>
              <p className="small muted" style={{margin:"0 0 12px"}}>
                Showing the latest {shown.length}. “Accepted” only means Gmail took the message, it does not guarantee it landed in the inbox.
              </p>
              <div className="table" style={{marginTop:0}}>
                <table>
                  <thead><tr><th>Nailan</th><th>Type</th><th>Saan</th><th>Status</th><th>Attempts</th><th>Sinabi ng SMTP</th></tr></thead>
                  <tbody>{shown.map(m=>{
                    const statusColor=m.status==="failed"?"#8A2C1D":m.status==="sent"?"#3F6B4F":undefined;
                    return (
                    <tr key={m.id}>
                      <td className="small">{(m.sent_at||m.created_at||"").replace("T"," ").slice(0,16)}</td>
                      <td className="small">{m.kind}</td>
                      <td className="small">{m.to_email||"(admin inbox)"}</td>
                      <td className="small" style={{color:statusColor}}>
                        {m.status}{m.status==="failed"&&m.last_error?` — ${m.last_error}`:""}
                      </td>
                      <td className="small">{m.attempts}/5</td>
                      <td className="small" style={{color:"#626A63"}}>{m.provider_response||"—"}</td>
                    </tr>);
                  })}
                  </tbody>
                </table>
              </div>
              {failed.length>0&&
                <button className="btn secondary" style={{marginTop:14,minHeight:42}} disabled={retryingMail} onClick={retryFailedMail}>
                  {retryingMail?"RETRYING…":"RETRY ALL NOW"}
                </button>}
            </>}
        </>;
      })()}
    </div>

    {/* -------- RECURRING PLANS -------- */}
    <div className="panel">
      <div className="panel-head"><strong>Recurring plans</strong><span className="small muted">Sets the discount the customer sees in the booking form, and the suggested price</span></div>
      {recurring.length===0
        ? <p className="small muted" style={{margin:0}}>No recurring plans yet.</p>
        : <>
          <div className="table" style={{marginTop:0}}>
            <table>
              <thead><tr><th>Plan</th><th>Label sa website</th><th>Discount (%)</th></tr></thead>
              <tbody>{recurring.map(r=>(
                <tr key={r.frequency}>
                  <td className="small">{r.label}</td>
                  <td className="small">{r.client_label||"—"}</td>
                  <td><input inputMode="decimal" value={r.discount_pct} style={{width:90}}
                    onChange={e=>setRecurring(list=>list.map(x=>x.frequency===r.frequency?{...x,discount_pct:e.target.value}:x))}/></td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{margin:"12px 0 0"}}>
            “One-time” should be 0. Existing bookings keep the percentage they were made under, so changing this does not
            rewrite the discount on deals that are already agreed.
          </p>
          <button className="btn" style={{marginTop:14,minHeight:42}} disabled={savingRec}
            onClick={saveRecurring}>
            {savingRec?"SAVING…":"SAVE RECURRING DISCOUNTS"}
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
