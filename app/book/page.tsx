"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { SiteHeader } from "@/components/SiteChrome";

const steps=["Service","Property","Scope","Materials","Location","Schedule","Customer","Review"];
const DEFAULT_SERVICE_OPTIONS=["Home Cleaning","Deep Cleaning","Move-In / Move-Out","Small Business"];
const propertyOptions=["Condo","Apartment","House","Office","Shop/Studio","Other"];
const areas=["Living room","Bedrooms","Kitchen","Bathrooms","Floors","Windows","Balcony","Appliances","Other"];

const PHOTO_BUCKET="booking-photos";
const MAX_PHOTO_BYTES=5*1024*1024;
const ALLOWED_PHOTO_TYPES=["image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif"];
const MAX_REF_ATTEMPTS=3;

const pad=(n:number)=>String(n).padStart(2,"0");

/** MAL-YYYYMMDD-HHMM in Asia/Manila time (UTC+8). */
function makeBookingRef(at=new Date()){
  const m=new Date(at.getTime()+8*60*60*1000);
  return `MAL-${m.getUTCFullYear()}${pad(m.getUTCMonth()+1)}${pad(m.getUTCDate())}-${pad(m.getUTCHours())}${pad(m.getUTCMinutes())}`;
}

type Frequency="once"|"weekly"|"biweekly"|"monthly";
type Plan={frequency:Frequency;label:string;clientLabel:string;discountPct:number};

/** The starting price is a display string like "₱1,300+", so the discount has
 *  to be applied to the number inside it. Anything unparseable is shown as-is
 *  rather than replaced with a wrong figure. */
function discountPriceText(text:string,pct:number){
  if(!pct) return text;
  const match=String(text).match(/[0-9][0-9,]*/);
  if(!match) return text;
  const base=Number(match[0].replace(/,/g,""));
  if(!Number.isFinite(base)||base<=0) return text;
  const discounted=Math.ceil((base*(1-pct/100))/50)*50;
  return `₱${discounted.toLocaleString("en-PH")}+`;
}

function randomSuffix(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

function friendlyError(error:any){
  const code=error?.code;
  const msg=String(error?.message||"");
  if(code==="23505") return null;
  if(code==="42501"||/permission denied/i.test(msg))
    return "Bookings are not accepting submissions yet — the database permissions (RLS) still need to be configured.";
  if(code==="42P01"||/does not exist/i.test(msg))
    return "The booking tables are not set up yet. Please run the migration SQL in the Supabase SQL Editor.";
  if(/Failed to fetch|NetworkError|fetch failed/i.test(msg))
    return "Could not reach the booking service. Please check your connection and try again.";
  return msg || "Something went wrong while saving your booking. Please try again.";
}

export default function Book() {
 const [step,setStep]=useState(0);
 const [submitted,setSubmitted]=useState(false);
 const [submitting,setSubmitting]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [photoNote,setPhotoNote]=useState<string|null>(null);
 const [bookingRef,setBookingRef]=useState("");
 const [data,setData]=useState<Record<string,any>>({service:"",property:"",areas:[],condition:"Normal",materials:"Customer provides materials",time:"Morning",photo:null});
 const [serviceOptions,setServiceOptions]=useState<string[]>(DEFAULT_SERVICE_OPTIONS);
 const [startingPrice,setStartingPrice]=useState("₱1,300+");
 const [deepPrice,setDeepPrice]=useState("₱3,500+");
 const [plans,setPlans]=useState<Plan[]>([
   {frequency:"once",label:"One-time",clientLabel:"",discountPct:0},
   {frequency:"weekly",label:"Weekly",clientLabel:"Every week",discountPct:10},
   {frequency:"biweekly",label:"Twice a week",clientLabel:"Twice a week",discountPct:15},
   {frequency:"monthly",label:"Monthly",clientLabel:"Once a month",discountPct:5},
 ]);
 const recurringOnly=plans.filter(p=>p.frequency!=="once");
 useEffect(()=>{
   let alive=true;
   (async()=>{
     try{
       const [svc,cards,settings,disc]=await Promise.all([
         supabase.from("services").select("name,active,sort_order").order("sort_order"),
         supabase.from("price_cards").select("label,amount,suffix").eq("label","Deep Cleaning").maybeSingle(),
         supabase.from("site_settings").select("key,value").eq("key","pricing_starting_from").maybeSingle(),
         supabase.from("recurring_discounts").select("frequency,label,client_label,discount_pct,sort_order").order("sort_order")
       ]);
       if(!alive) return;
       const names=(svc.data||[]).filter(r=>r.active!==false&&r.name).map(r=>r.name);
       if(names.length) setServiceOptions(names);
       if(cards.data) setDeepPrice(`₱${Number(cards.data.amount||0).toLocaleString("en-PH")}${cards.data.suffix||""}`);
       if(settings.data?.value) setStartingPrice(String(settings.data.value));
       const rows=(disc.data||[]).filter((r:any)=>r&&r.frequency).map((r:any)=>({
         frequency:r.frequency as Frequency,
         label:String(r.label??""),
         clientLabel:String(r.client_label??""),
         discountPct:Number(r.discount_pct)||0
       }));
       // Only a total gap falls back to the hardcoded seeds, so editing a
       // percentage in Settings takes effect on the live site immediately.
       if(rows.length) setPlans(rows);
     }catch{ /* keep hardcoded defaults */ }
   })();
   return ()=>{alive=false;};
 },[]);
 const set=(k:string,v:any)=>setData(d=>({...d,[k]:v}));
 const toggleArea=(a:string)=>set("areas",(data.areas||[]).includes(a)?data.areas.filter((x:string)=>x!==a):[...(data.areas||[]),a]);
 const chosenPlan=plans.find(p=>p.frequency===(data.frequency||"once"))||plans[0];
 const discountPct=chosenPlan?chosenPlan.discountPct:0;
 const estimate=useMemo(()=>{
   const base=data.service==="Deep Cleaning"?deepPrice:startingPrice;
   return {
     cleaners:data.property==="House"||data.property==="Office"?2:1,
     hours:data.service==="Deep Cleaning"?6:5,
     price:discountPriceText(base,discountPct),
     basePrice:base,
     discountPct,
   };
 },[data,deepPrice,startingPrice,discountPct]);

 const onPhoto=(file:File|null)=>{
   if(!file){set("photo",null);setError(null);return;}
   if(file.size>MAX_PHOTO_BYTES){set("photo",null);setError("That photo is larger than 5MB. Please choose a smaller image.");return;}
   if(!ALLOWED_PHOTO_TYPES.includes(file.type)){set("photo",null);setError("Please upload an image file (JPG, PNG, WEBP, GIF or HEIC).");return;}
   setError(null);
   set("photo",file);
 };

 const uploadPhoto=async(ref:string,file:File)=>{
   const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
   const path=`${ref}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
   const { error:upErr }=await supabase.storage.from(PHOTO_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
   if(upErr) throw upErr;
   return path;
 };

 const submitBooking=async()=>{
   if(submitting) return;
   setSubmitting(true);
   setError(null);
   setPhotoNote(null);
   try{
     if(!data.service) throw new Error("Please choose a service to continue.");
     if(!data.property) throw new Error("Please select a property type to continue.");
     if(!data.address?.trim()) throw new Error("Please enter the service address to continue.");
     if(!data.date) throw new Error("Please choose a preferred date to continue.");
     if(!String(data.name||"").trim()) throw new Error("Please enter your full name to continue.");
     if(!String(data.mobile||"").trim()) throw new Error("Please enter your mobile number to continue.");
     if(!String(data.email||"").trim()) throw new Error("Please enter your email address to continue.");

     const photo=data.photo as File|null;
     const baseRef=makeBookingRef();
     let lastError:any=null;
     let photoFailed=false;

     for(let attempt=0;attempt<MAX_REF_ATTEMPTS;attempt++){
       const ref=attempt===0?baseRef:`${baseRef}-${randomSuffix()}`;
       let photoPath:string|null=null;

       if(photo){
         try{
           photoPath=await uploadPhoto(ref,photo);
         }catch{
           photoPath=null;
           photoFailed=true;
         }
       }

       // Text columns are sent as "" (never null) so a NOT NULL constraint
       // without a default still passes. Numeric/date columns are omitted
       // when empty so the database default applies instead of null.
       const payload:Record<string,any>={
         booking_ref:ref,
         services:data.service,
         property:data.property||"",
         sqm:data.sqm?String(data.sqm):"",
         areas:Array.isArray(data.areas)?data.areas.join(", "):"",
         condition:data.condition||"",
         scope_notes:data.scopeNotes||"",
         materials:data.materials||"",
         adress:data.address||"",
         city:data.city||"",
         province:data.province||"",
         landmark:data.landmark||"",
         access:data.access||"",
         time:data.time||"",
         names:data.name||"",
         phone:data.mobile||"",
         email:data.email||"",
         notes:data.notes||"",
         status:"New Request",
         frequency:chosenPlan?chosenPlan.frequency:"once"
       };
       if(data.bedrooms) payload.bedrooms=Number.parseInt(data.bedrooms,10);
       if(data.bathrooms) payload.bathrooms=Number.parseInt(data.bathrooms,10);
       if(data.date) payload.date=data.date;
       if(photoPath) payload.photo_path=photoPath;

       const { error:insertErr }=await supabase.from("bookings").insert(payload);

       if(!insertErr){
         setBookingRef(ref);
         if(photoFailed) setPhotoNote("Your photo could not be uploaded, but the booking itself was still saved.");
         setSubmitted(true);
         setSubmitting(false);
         return;
       }
       if(insertErr.code==="23505"){lastError=insertErr;continue;}
       throw insertErr;
     }
     throw lastError||new Error("Could not create a unique booking reference. Please try again.");
   }catch(err:any){
     setError(friendlyError(err));
     setSubmitting(false);
   }
 };

 if(submitted) return <main><SiteHeader minimal /><div className="booking-wrap"><div className="booking-shell"><div className="eyebrow">REQUEST RECEIVED</div><h2>Thank you.</h2><p className="lead">Your cleaning request has been received. MALTO will review the request, check availability, confirm the final price and contact you.</p><div className="notice"><strong>Request ID:</strong> {bookingRef}<br/><strong>Requested appointment:</strong> {data.date || "Your requested date"} — {data.time}</div>{photoNote&&<div className="notice">{photoNote}</div>}<Link className="btn" href="/">BACK TO HOME</Link></div></div></main>;
 const next=()=>setStep(s=>Math.min(7,s+1)); const back=()=>setStep(s=>Math.max(0,s-1));
 return <main><SiteHeader backHref="/" minimal />
 <div className="booking-wrap"><div className="booking-shell"><div className="progress">{steps.map((_,i)=><span className={i<=step?"active":""} key={i}/>)}</div><div className="eyebrow">STEP {step+1} OF 8</div><h2>{steps[step]}</h2>
 {step===0&&<>
   <div className="choice-grid">{serviceOptions.map(x=><label className="choice" key={x}><input type="radio" checked={data.service===x} onChange={()=>set("service",x)}/>{x}</label>)}</div>
   {recurringOnly.length>0&&<>
     <div className="eyebrow" style={{margin:"30px 0 4px"}}>HOW OFTEN</div>
     <p className="small muted" style={{margin:"0 0 12px"}}>Booking on a schedule means the same visit repeats automatically, and the price drops.</p>
     <div className="choice-grid">
       <label className="choice"><input type="radio" name="frequency" checked={!data.frequency||data.frequency==="once"} onChange={()=>set("frequency","once")}/>One-time</label>
       {recurringOnly.map(p=><label className="choice" key={p.frequency}>
         <input type="radio" name="frequency" checked={data.frequency===p.frequency} onChange={()=>set("frequency",p.frequency)}/>
         {p.clientLabel||p.label}
         {p.discountPct>0&&<span className="small" style={{display:"block",color:"#3F6B4F",marginTop:6}}>Save {p.discountPct}%</span>}
       </label>)}
     </div>
     {discountPct>0&&<div className="estimate" style={{marginTop:18}}>
       <p style={{margin:"0 0 6px"}}>Estimated per visit: <strong>{estimate.price}</strong></p>
       <p className="small muted" style={{margin:0}}>Was {estimate.basePrice}. Final price is confirmed after MALTO reviews the request.</p>
     </div>}
   </>}
 </>}
 {step===1&&<div className="form-grid"><div className="field"><label>Property Type</label><select value={data.property} onChange={e=>set("property",e.target.value)}><option value="">Select</option>{propertyOptions.map(x=><option key={x}>{x}</option>)}</select></div><div className="field"><label>Approximate sqm</label><input value={data.sqm||""} onChange={e=>set("sqm",e.target.value)}/></div><div className="field"><label>Bedrooms</label><input type="number" value={data.bedrooms||""} onChange={e=>set("bedrooms",e.target.value)}/></div><div className="field"><label>Bathrooms</label><input type="number" value={data.bathrooms||""} onChange={e=>set("bathrooms",e.target.value)}/></div></div>}
 {step===2&&<><div className="choice-grid">{areas.map(a=><label className="choice" key={a}><input type="checkbox" checked={(data.areas||[]).includes(a)} onChange={()=>toggleArea(a)}/>{a}</label>)}</div><div className="field" style={{marginTop:18}}><label>Condition</label><select value={data.condition} onChange={e=>set("condition",e.target.value)}>{["Light","Normal","Needs attention","Heavy buildup"].map(x=><option key={x}>{x}</option>)}</select></div><div className="field" style={{marginTop:18}}><label>Notes</label><textarea value={data.scopeNotes||""} onChange={e=>set("scopeNotes",e.target.value)}/></div></>}
 {step===3&&<div className="choice-grid">{["Customer provides materials","MALTO provides materials"].map(x=><label className="choice" key={x}><input type="radio" checked={data.materials===x} onChange={()=>set("materials",x)}/>{x}</label>)}</div>}
 {step===4&&<div className="form-grid"><div className="field full"><label>Address</label><input value={data.address||""} onChange={e=>set("address",e.target.value)}/></div><div className="field"><label>City / Municipality</label><input value={data.city||""} onChange={e=>set("city",e.target.value)}/></div><div className="field"><label>Province</label><input value={data.province||""} onChange={e=>set("province",e.target.value)}/></div><div className="field"><label>Landmark</label><input value={data.landmark||""} onChange={e=>set("landmark",e.target.value)}/></div><div className="field"><label>Access instructions</label><input value={data.access||""} onChange={e=>set("access",e.target.value)}/></div></div>}
 {step===5&&<div className="form-grid"><div className="field"><label>Preferred Date</label><input type="date" value={data.date||""} onChange={e=>set("date",e.target.value)}/></div><div className="field"><label>Preferred Time</label><select value={data.time} onChange={e=>set("time",e.target.value)}><option>Morning</option><option>Afternoon</option><option>Evening</option></select></div><div className="field full"><div className="notice">Subject to availability.</div></div></div>}
 {step===6&&<div className="form-grid"><div className="field"><label>Full Name</label><input value={data.name||""} onChange={e=>set("name",e.target.value)}/></div><div className="field"><label>Mobile Number</label><input value={data.mobile||""} onChange={e=>set("mobile",e.target.value)}/></div><div className="field full"><label>Email</label><input type="email" value={data.email||""} onChange={e=>set("email",e.target.value)}/></div><div className="field full"><label>Notes</label><textarea value={data.notes||""} onChange={e=>set("notes",e.target.value)}/></div><div className="field full"><label>Optional Photo Upload</label><input type="file" accept="image/*" onChange={e=>onPhoto(e.target.files?.[0]||null)}/><span className="small">{data.photo?`${data.photo.name} — ${(data.photo.size/1024/1024).toFixed(1)}MB (max 5MB)`:"JPG, PNG, WEBP, GIF or HEIC"}</span></div></div>}
 {step===7&&<><div className="notice">Final price is confirmed after MALTO reviews the request.</div><div className="estimate">
   <p><strong>Service:</strong> {data.service||"—"}</p>
   <p><strong>Frequency:</strong> {chosenPlan?chosenPlan.label:"One-time"}{discountPct>0&&` (${discountPct}% recurring discount applied)`}</p>
   {data.frequency&&data.frequency!=="once"&&data.date&&<p className="small muted" style={{margin:0}}>Your first visit is {data.date}. The same booking repeats automatically every {chosenPlan?.label.toLowerCase().replace(/^twice a /,"")??"week"} after that, and you will get an email before each one.</p>}
   <p><strong>Estimated cleaners:</strong> {estimate.cleaners}</p>
   <p><strong>Estimated hours:</strong> {estimate.hours}</p>
   <p><strong>Estimated price range:</strong> {estimate.price}{discountPct>0&&<span className="small muted"> (was {estimate.basePrice})</span>}</p>
 </div></>}
 {error&&<div className="notice" style={{background:"#FBE9E7",color:"#8A2C1D"}}>{error}</div>}
 <div className="booking-actions">{step>0?<button className="btn secondary" onClick={back} disabled={submitting} style={{opacity:submitting?.6:1}}>BACK</button>:<span/>}{step<7?<button className="btn" onClick={next}>CONTINUE</button>:<button className="btn" onClick={submitBooking} disabled={submitting} style={{opacity:submitting?.6:1,pointerEvents:submitting?"none":"auto"}}>{submitting?"SUBMITTING…":"REQUEST BOOKING"}</button>}</div>
 </div></div></main>
}
