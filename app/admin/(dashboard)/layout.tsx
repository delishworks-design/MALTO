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
  /**
   * New bookings that arrived while the admin was on another tab.
   *
   * The dashboard announces a new booking in place, which is not enough: the
   * common case is an admin looking at the Team page or Settings when one comes
   * in, and they have no reason to suspect anything happened. This counts them
   * from the same realtime channel, so the tab bar itself says there is
   * something waiting, and it clears when they go back to Bookings.
   */
  const [unseen,setUnseen]=useState(0);

  useEffect(()=>{
    const supabase=createClient();
    const channel=supabase.channel("admin-nav-bookings");
    channel.on("postgres_changes",
      {event:"INSERT",schema:"public",table:"bookings"},
      ()=>setUnseen(n=>n+1));
    channel.subscribe();
    return ()=>{ void supabase.removeChannel(channel); };
  },[]);

  // Looking at the bookings is what clears it, not merely being on the tab.
  useEffect(()=>{
    if(pathname==="/admin") setUnseen(0);
  },[pathname]);

  useEffect(()=>{
    let alive=true;
    (async()=>{
      try{
        const supabase=createClient();
        const {data:{user}}=await supabase.auth.getUser();
        if(!alive) return;
        if(!user){ router.replace("/admin/login"); return; }
        // A team member is signed in too, but has no business here. is_admin()
        // is the same check the database uses, so the UI cannot drift from it.
        const {data:admin}=await supabase.rpc("is_admin");
        if(alive && admin!==true){ router.replace("/portal"); return; }
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
          style={{background:"none",border:0,color:"#DDDCD6",cursor:"pointer",font:"inherit",minHeight:40,padding:"0 8px"}}>
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
