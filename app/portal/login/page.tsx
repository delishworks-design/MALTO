"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function PortalLogin(){
  const router=useRouter();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);

  const signIn=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(busy) return;
    setBusy(true); setError(null);
    try{
      const {error:err}=await createClient().auth.signInWithPassword({email:email.trim(),password});
      if(err){
        setError(/invalid login credentials/i.test(err.message)?"Incorrect email or password.":err.message);
        return;
      }
      router.push("/portal");
      router.refresh();
    }catch{
      setError("Could not reach the sign-in service. Please try again.");
    }finally{ setBusy(false); }
  };

  return <main className="portal-page">
    <header className="header"><div className="container nav">
      <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      <Link className="small" href="/">Back to website</Link>
    </div></header>

    <div className="portal-shell">
      <div className="eyebrow">TEAM PORTAL</div>
      <h2>Sign in.</h2>
      <p className="lead">Your assigned cleaning jobs appear here.</p>

      <form onSubmit={signIn} style={{marginTop:26}}>
        <div className="form-grid">
          <div className="field full"><label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username" placeholder="you@gmail.com"/></div>
          <div className="field full"><label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></div>
        </div>

        {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}

        <div className="booking-actions">
          <span/>
          <button className="btn" disabled={busy} style={{opacity:busy?.6:1}}>
            {busy?"SIGNING IN…":"SIGN IN"}
          </button>
        </div>
      </form>

      <p className="small muted" style={{marginTop:24}}>
        No account yet? <Link href="/portal/register" style={{textDecoration:"underline"}}>Create one here</Link>.
      </p>
    </div>
  </main>;
}
