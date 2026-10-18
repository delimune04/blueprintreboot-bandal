"use client";
import "../lib/collaboration/quick-share.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { getWorkspaceMode, getWorkspaceRole, getWorkspaceStorageScope, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { createQuickIdeaDraft, sendQuickIdeaDraft, type QuickIdeaDraft, type QuickIdeaSource } from "../lib/collaboration/quick-share.mjs";

export function QuickIdeaButton({ source, disabled = false }: { source: QuickIdeaSource; disabled?: boolean }) {
  const {locale}=useI18n(),ko=locale==="ko",router=useRouter();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const sending=useRef(false),pending=useRef<{scope:string;sourceKey:string;draft:QuickIdeaDraft}|null>(null);
  const mode=getWorkspaceMode();
  if(mode==="local")return null;
  const viewer=getWorkspaceRole()==="viewer";
  async function send(){
    if(sending.current||disabled||viewer)return;
    const scope=getWorkspaceStorageScope();
    const sourceKey=`${source.type}:${source.id}`;
    if(!pending.current||pending.current.scope!==scope||pending.current.sourceKey!==sourceKey)pending.current={scope,sourceKey,draft:createQuickIdeaDraft(source,crypto.randomUUID(),locale)};
    sending.current=true;setBusy(true);setError("");
    try{
      const result=await sendQuickIdeaDraft(pending.current.draft,{request:labviumRequest,scope,getScope:getWorkspaceStorageScope});
      pending.current=null;
      router.push(`/collaboration/ideas/${encodeURIComponent(result.result_id)}`);
    }catch(e){
      const code=(e as {code?:string})?.code,status=(e as {status?:number})?.status;
      setError(ko?code==="workspace_changed"?"작업 공간이 바뀌었습니다. 현재 공간에서 자료를 다시 열어주세요.":status===403?"의견을 요청하려면 이 공간의 편집 권한이 필요합니다.":status===409?"다른 곳에서 변경됐습니다. 다시 눌러 요청을 확인해 주세요.":status===422?"현재 공간에 저장된 자료인지 확인한 뒤 다시 시도해 주세요.":"의견 요청의 저장 상태를 확인하지 못했습니다. 다시 누르면 같은 요청으로 확인합니다.":e instanceof Error?e.message:"Could not confirm the saved question. Retry the same request.");
    }
    finally{sending.current=false;setBusy(false);}
  }
  return <span className="lv-quick-idea"><button type="button" className="reader-control reader-control--secondary" disabled={busy||disabled||viewer} onClick={()=>void send()} title={viewer?(ko?"의견을 요청하려면 편집 권한이 필요합니다.":"An editor role is required to ask for feedback."):mode==="cloud"?(ko?"저장된 이 자료를 현재 연구실의 아이디어 게시판에 공유합니다. 메일은 발송하지 않습니다.":"Share this saved source with the current workspace. No email is sent."):(ko?"현재 브라우저의 아이디어 게시판에 저장합니다. 동료와 공유하려면 팀 공간을 선택하세요.":"Save an idea on this browser. Choose a team workspace to share with colleagues.")}><MessageCircleQuestion size={15}/>{busy?(ko?"의견 요청 저장 중…":"Saving question…"):mode==="cloud"?(ko?"이 아이디어 어때요?":"Ask for feedback"):(ko?"아이디어로 남기기":"Keep as an idea")}</button>{error?<span className="lv-quick-idea__error" role="alert">{error} <Link href="/collaboration">{ko?"협업 공간 열기":"Open collaboration"}</Link></span>:null}</span>;
}
