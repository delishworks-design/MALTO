"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function AdminLogin(){
  const router=useRouter();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);

  const signIn=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(loading) return;
    setLoading(true);
    setError(null);
    try{
      const supabase=createClient();
      const { error:err }=await supabase.auth.signInWithPassword({email:email.trim(),password});
      if(err){
        setError(/invalid login credentials/i.test(err.message)?"Incorrect email or password.":err.message);
        return;
      }
      router.push("/admin");
      router.refresh();
    }catch{
      setError("Could not reach the login service. Please try again.");
    }finally{
      setLoading(false);
    }
  };

  return <main>
    <header className="header"><div className="container nav">
      <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      <Link className="small" href="/">Back to website</Link>
    </div></header>

    <div className="booking-wrap"><div className="booking-shell">
      <div className="eyebrow">MALTO ADMIN</div>
      <h2>Sign in.</h2>
      <p className="lead">Operations dashboard access is restricted to MALTO staff.</p>

      <form onSubmit={signIn}>
        <div className="form-grid">
          <div className="field full">
            <label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" placeholder="admin@example.com" required/>
          </div>
          <div className="field full">
            <label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/>
          </div>
        </div>

        {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}

        <div className="booking-actions">
          <Link className="btn secondary" href="/">BACK TO WEBSITE</Link>
          <button className="btn" type="submit" disabled={loading} style={{opacity:loading?.6:1}}>
            {loading?"SIGNING IN…":"SIGN IN"}
          </button>
        </div>
      </form>
    </div></div>
  </main>;
}
