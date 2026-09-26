"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const TABS=[
  { href:"/admin",           label:"Bookings"  },
  { href:"/admin/calendar",  label:"Calendar"  },
  { href:"/admin/customers", label:"Customers" },
  { href:"/admin/services",  label:"Services"  },
  { href:"/admin/pricing",   label:"Pricing"   },
  { href:"/admin/team",      label:"Team"      },
  { href:"/admin/settings",  label:"Settings"  },
];

export default function AdminLayout({children}:{children:React.ReactNode}){
  const pathname=usePathname();
  const router=useRouter();
  const [email,setEmail]=useState("");

  useEffect(()=>{
    let alive=true;
    (async()=>{
      try{
        const {data:{user}}=await createClient().auth.getUser();
        if(!alive) return;
        if(!user){ router.replace("/admin/login"); return; }
        setEmail(user.email||"");
      }catch{
        if(alive) router.replace("/admin/login");
      }
    })();
    return ()=>{alive=false;};
  },[router]);

  const signOut=async()=>{
    try{ await createClient().auth.signOut(); }catch{/* ignore */}
    router.replace("/admin/login");
    router.refresh();
  };

  return <main className="admin">
    <div className="admin-nav">
      <strong>MALTO ADMIN</strong>
      <span style={{display:"flex",gap:18,alignItems:"center"}}>
        <span className="small" style={{color:"#DDDCD6"}}>{email}</span>
        <button className="small" onClick={signOut}
          style={{background:"none",border:0,color:"#DDDCD6",cursor:"pointer",font:"inherit"}}>
          Sign out
        </button>
      </span>
    </div>

    <nav className="admin-tabs">
      {TABS.map(t=>{
        const active=t.href==="/admin"?pathname==="/admin":pathname.startsWith(t.href);
        return <Link key={t.href} href={t.href} className={"admin-tab"+(active?" active":"")}>{t.label}</Link>;
      })}
    </nav>

    <div className="admin-body">{children}</div>
  </main>;
}
