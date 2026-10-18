"use client";
import "../lib/collaboration/quick-share.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { getWorkspaceMode, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";

/** A read-only, visibility-aware inbox indicator; delivery stays inside LabVium. */
export function CollaborationInboxLink(){
 const {locale}=useI18n(),ko=locale==="ko";
 const [unread,setUnread]=useState<number|null>(null);
 useEffect(()=>{
  if(getWorkspaceMode()==="local")return;
  let active=true,pending=false;
  const controller=new AbortController();
  async function refresh(){
   if(!active||pending||document.hidden)return;
   pending=true;
   try{const value=await labviumRequest<{unread_count:number;revision:string}>("/collaboration/summary",{signal:controller.signal});if(active)setUnread(value.unread_count);}
   catch{/* The full inbox owns retryable errors; a failed poll never invents a count. */}
   finally{pending=false;}
  }
  void refresh();const timer=window.setInterval(()=>void refresh(),30000);
  const wake=()=>void refresh();document.addEventListener("visibilitychange",wake);window.addEventListener("focus",wake);window.addEventListener("labvium:collaboration-changed",wake);
  return()=>{active=false;controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",wake);window.removeEventListener("focus",wake);window.removeEventListener("labvium:collaboration-changed",wake);};
 },[]);
 if(getWorkspaceMode()==="local")return null;
 return <Link href="/collaboration/inbox" className="lv-inbox-link" aria-label={ko?`협업 알림${unread?` ${unread}개 읽지 않음`:""}`:`Collaboration inbox${unread?`, ${unread} unread`:""}`}><Bell size={15} aria-hidden="true"/><span>{ko?"알림":"Inbox"}</span>{unread!==null&&unread>0?<strong className="lv-inbox-count">{unread>99?"99+":unread}</strong>:null}</Link>;
}
