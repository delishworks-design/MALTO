"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const TEAM_BUCKET="team-photos";

type Member={
  id:string; name:string; role:string; phone:string; email:string;
  hire_date:string; bio:string; photo_path:string; active:boolean; sort_order:number;
  isNew?:boolean;
};

const blank=():Member=>({id:"",name:"",role:"",phone:"",email:"",hire_date:"",bio:"",photo_path:"",active:true,sort_order:99,isNew:true});

export default function TeamAdmin(){
  const [items,setItems]=useState<Member[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [photos,setPhotos]=useState<Record<string,string>>({});
  const [open,setOpen]=useState<string|null>(null);

  const flash=(m:string)=>{ setNotice(m); setTimeout(()=>setNotice(null),2600); };

  const load=useCallback(async()=>{
    setLoading(true); setError(null);
    try{
      const supabase=createClient();
      const { data:{ user } }=await supabase.auth.getUser();
      if(!user) return;
      const {data,error:err}=await supabase.from("team_members").select("*").order("sort_order");
      if(err) throw err;
      setItems((data||[]).map(m=>({
        id:m.id,name:m.name,role:m.role,phone:m.phone,email:m.email,
        hire_date:m.hire_date||"",bio:m.bio,photo_path:m.photo_path,
        active:m.active,sort_order:m.sort_order
      })));
    }catch(e:any){ setError(e?.message||"Could not load team."); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ load(); },[load]);

  // Lazily create signed URLs for every uploaded photo (idempotent).
  useEffect(()=>{
    const seen:Record<string,boolean>={};
    const need=items.map(m=>m.photo_path).filter(p=>!!p&&!seen[p]&&(seen[p]=true)&&!photos[p]);
    if(!need.length) return;
    let alive=true;
    (async()=>{
      const supabase=createClient();
      for(const p of need){
        try{
          const {data,error}=await supabase.storage.from(TEAM_BUCKET).createSignedUrl(p,3600);
          if(!alive) return;
          if(!error&&data?.signedUrl) setPhotos(prev=>({...prev,[p]:data.signedUrl}));
        }catch{/* photo is optional */}
      }
    })();
    return ()=>{alive=false;};
  },[items,photos]);

  const signPhoto=async(path:string)=>{
    if(!path||photos[path]) return;
    try{
      const supabase=createClient();
      const {data,error}=await supabase.storage.from(TEAM_BUCKET).createSignedUrl(path,3600);
      if(!error&&data?.signedUrl) setPhotos(p=>({...p,[path]:data.signedUrl}));
    }catch{/* optional */}
  };

  const patch=(id:string,p:Partial<Member>)=>setItems(l=>l.map(x=>x.id===id?{...x,...p}:x));

  const onPhoto=async(id:string,file:File|null)=>{
    if(!file) return;
    if(!file.type.startsWith("image/")){ setError("Images only."); return; }
    if(file.size>5*1024*1024){ setError("Max 5MB."); return; }
    setBusy(id); setError(null);
    try{
      const supabase=createClient();
      const ext=(file.name.split(".").pop()||"jpg").toLowerCase();
      const path=`${crypto.randomUUID()}/photo.${ext}`;
      const {error:err}=await supabase.storage.from(TEAM_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
      if(err) throw err;
      const old=items.find(x=>x.id===id)?.photo_path;
      setItems(l=>l.map(x=>x.id===id?{...x,photo_path:path}:x));
      if(old) try{ await supabase.storage.from(TEAM_BUCKET).remove([old]); }catch{/* old photo cleanup */}
      flash("Photo uploaded.");
    }catch(e:any){ setError(e?.message||"Photo upload failed."); }
    finally{ setBusy(null); }
  };

  const save=async(m:Member)=>{
    if(busy) return;
    setBusy(m.id||"new"); setError(null);
    try{
      if(!m.name.trim()) throw new Error("Kailangan ng pangalan.");
      const supabase=createClient();
      const payload={
        name:m.name.trim(),role:m.role,phone:m.phone,email:m.email,
        hire_date:m.hire_date||null,bio:m.bio,photo_path:m.photo_path,
        active:m.active,sort_order:m.sort_order
      };
      if(m.isNew){
        const {error:err}=await supabase.from("team_members").insert(payload);
        if(err) throw err;
      }else{
        const {error:err}=await supabase.from("team_members").update(payload).eq("id",m.id);
        if(err) throw err;
      }
      flash(m.isNew?"Team member added.":"Team member saved.");
      await load();
    }catch(e:any){ setError(e?.message||"Could not save."); }
    finally{ setBusy(null); }
  };

  const remove=async(m:Member)=>{
    if(!m.id) return;
    if(!confirm(`Delete ${m.name}?`)) return;
    setBusy(m.id); setError(null);
    try{
      const supabase=createClient();
      const {error:err}=await supabase.from("team_members").delete().eq("id",m.id);
      if(err) throw err;
      if(m.photo_path) try{ await supabase.storage.from(TEAM_BUCKET).remove([m.photo_path]); }catch{/* ignore */}
      flash("Team member deleted.");
      await load();
    }catch(e:any){ setError(e?.message||"Could not delete."); }
    finally{ setBusy(null); }
  };

  return <>
    {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
    {notice&&<div className="notice">{notice}</div>}

    <div className="eyebrow">TEAM</div>
    <h1>Meet the people behind the work.</h1>
    <p className="small muted">Admin-only ang mga profile na ito — hindi ito lumalabas sa public website.</p>

    <div className="toolbar">
      <button className="btn" style={{minHeight:42}} onClick={()=>{setItems(l=>[blank(),...l]);setOpen("new");}}>+ ADD MEMBER</button>
      <span className="small muted">{items.length} member{items.length===1?"":"s"}</span>
    </div>

    {loading?<p className="text" style={{padding:20}}>Loading team…</p>
    :items.length===0?<p className="text" style={{padding:20}}>Walang member pa. Gamitin ang “+ ADD MEMBER”.</p>
    :<div className="teamgrid">
      {items.map(m=>{
        const key=m.id||"new";
        const isOpen=open===key;
        return <div className="teamcard" key={key}>
          <div className="teamcard-top" onClick={()=>setOpen(isOpen?null:key)}>
            {m.photo_path&&photos[m.photo_path]
              ?<img src={photos[m.photo_path]} alt={m.name} className="teamphoto"/>
              :<div className="teamphoto teamphoto-empty">{(m.name||"?").slice(0,1).toUpperCase()}</div>}
            <div style={{flex:1,minWidth:0}}>
              <strong className="custcard-name">{m.name||"New member"}</strong>
              <div className="small muted">{m.role||"Walang role"}</div>
              <div className="small muted">
                {m.hire_date?`Hired ${new Date(m.hire_date+"T00:00:00").toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"})}`:"Walang hire date"}
                {" · "}<span className={"badge"+(m.active?" on":"")}>{m.active?"Active":"Inactive"}</span>
              </div>
            </div>
            <span className="small muted">{isOpen?"▾":"▸"}</span>
          </div>

          {isOpen&&<div className="teamcard-body" onClick={e=>e.stopPropagation()}>
            <div className="form-grid">
              <div className="field"><label>Name</label>
                <input value={m.name} onChange={e=>patch(key,{name:e.target.value})} placeholder="Juan Dela Cruz"/></div>
              <div className="field"><label>Role</label>
                <input value={m.role} onChange={e=>patch(key,{role:e.target.value})} placeholder="Team Lead"/></div>
              <div className="field"><label>Phone</label>
                <input value={m.phone} onChange={e=>patch(key,{phone:e.target.value})} placeholder="09xx xxx xxxx"/></div>
              <div className="field"><label>Email</label>
                <input type="email" value={m.email} onChange={e=>patch(key,{email:e.target.value})} placeholder="name@example.com"/></div>
              <div className="field"><label>Date hired</label>
                <input type="date" value={m.hire_date} onChange={e=>patch(key,{hire_date:e.target.value})}/></div>
              <div className="field"><label>Sort order</label>
                <input type="number" value={m.sort_order} onChange={e=>patch(key,{sort_order:Number(e.target.value)||0})}/></div>
              <div className="field full"><label>Short bio</label>
                <textarea value={m.bio} onChange={e=>patch(key,{bio:e.target.value})}
                  placeholder="Taon ng karanasan, specialty, atbp."/></div>
              <div className="field full">
                <label>Photo (max 5MB)</label>
                <input type="file" accept="image/*" onChange={e=>onPhoto(key,e.target.files?.[0]||null)}/>
                {m.photo_path&&(photos[m.photo_path]
                  ?<img src={photos[m.photo_path]} alt="" style={{width:120,height:120,objectFit:"cover",border:"1px solid var(--border)"}}/>
                  :<span className="small muted">Photo na-upload na. <button className="linkbtn" onClick={()=>signPhoto(m.photo_path)}>I-preview</button></span>)}
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
              <button className="btn" disabled={busy===key} style={{minHeight:42,opacity:busy===key?.6:1}} onClick={()=>save(m)}>
                {busy===key?"SAVING…":"SAVE"}
              </button>
              <button className="btn secondary" style={{minHeight:42}} onClick={()=>patch(key,{active:!m.active})}>
                {m.active?"Set inactive":"Set active"}
              </button>
              {m.id&&<button className="btn secondary" style={{minHeight:42}} disabled={busy===key} onClick={()=>remove(m)}>DELETE</button>}
            </div>
          </div>}
        </div>;
      })}
    </div>}
  </>;
}
