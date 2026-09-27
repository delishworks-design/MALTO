"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function PortalRegister(){
  const router=useRouter();
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [phone,setPhone]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);

  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(busy) return;
    setBusy(true); setError(null);
    try{
      const res=await fetch("/api/portal/register",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:name.trim(),email:email.trim(),password,phone:phone.trim()})
      });
      const j=await res.json().catch(()=>({} as any));
      if(!res.ok||!j.ok) throw new Error(j.error||"Could not create your account.");

      // The account exists and is already confirmed, so sign in immediately
      // rather than making the applicant type everything twice.
      const {error:signInErr}=await createClient().auth.signInWithPassword({email:email.trim(),password});
      if(signInErr) throw new Error("Account created, but sign-in failed. Please sign in.");
      router.push("/portal");
      router.refresh();
    }catch(err:any){ setError(err?.message||"Could not create your account."); }
    finally{ setBusy(false); }
  };

  return <main className="portal-page">
    <header className="header"><div className="container nav">
      <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      <Link className="small" href="/portal/login">Already registered? Sign in</Link>
    </div></header>

    <div className="portal-shell">
      <div className="eyebrow">TEAM PORTAL</div>
      <h2>Create your account.</h2>
      <p className="lead">Set a password you can remember. MALTO will review your account before any job appears here.</p>

      <form onSubmit={submit} style={{marginTop:26}}>
        <div className="form-grid">
          <div className="field full"><label>Full name</label>
            <input value={name} onChange={e=>setName(e.target.value)} required placeholder="Juan Dela Cruz" autoComplete="name"/></div>
          <div className="field"><label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@gmail.com" autoComplete="email"/></div>
          <div className="field"><label>Mobile number</label>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="09xx xxx xxxx" autoComplete="tel"/></div>
          <div className="field full"><label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required
              minLength={8} autoComplete="new-password" placeholder="At least 8 characters"/>
            <span className="small muted">At least 8 characters. You will use this every time you sign in.</span></div>
        </div>

        {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}

        <div className="booking-actions">
          <span/>
          <button className="btn" disabled={busy} style={{opacity:busy?.6:1}}>
            {busy?"CREATING…":"CREATE ACCOUNT"}
          </button>
        </div>
      </form>
    </div>
  </main>;
}
