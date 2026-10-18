"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Cloud, RefreshCw, ShieldCheck } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { ErrorState, LoadingState } from "../components/AsyncStates";
import { useApiResource } from "../hooks/useApiResource";
import { getWorkspaceMode, getWorkspaceSession, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";

type WorkspaceInfo = { title:string;role:string;paper_count:number;project_count:number;research_page_count:number;pdf_count:number;updated_at?:string;revision:string };
function CloudAccount() {
  const {locale}=useI18n(),ko=locale==="ko",tr=(a:string,b:string)=>ko?a:b;
  const resource=useApiResource("account-workspace",()=>labviumRequest<WorkspaceInfo>("/workspace"));
  const [hasBrowserData,setHasBrowserData]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const [preview,setPreview]=useState<{backup_id:string;paper_count:number;project_count:number;workspace_revision:string}|null>(null);
  useEffect(()=>{let active=true;void import("../lib/demo/browser-storage.mjs").then(async m=>{const raw=await m.getBrowserWorkspaceStorage().getItem(m.BROWSER_WORKSPACE_KEY);if(active)setHasBrowserData(raw!==null);}).catch(()=>{});return()=>{active=false;};},[]);
  if(resource.status==="loading")return <LoadingState label={tr("저장 상태를 확인하는 중","Checking account storage")}/>;
  if(resource.status!=="success")return <ErrorState description={resource.message} onRetry={resource.retry}/>;
  const data=resource.data,empty=data.paper_count===0&&data.project_count===0&&data.research_page_count===0&&data.pdf_count===0;
  async function previewBrowserImport(){
    setBusy(true);setNotice("");setPreview(null);
    try{
      const [{exportBrowserWorkspace}, {createResearchPagesStore}]=await Promise.all([import("../lib/demo/browser-storage.mjs"),import("../lib/workspace/pages.mjs")]);
      const archive={...await exportBrowserWorkspace(),research_pages:createResearchPagesStore().export()};
      const value=await labviumRequest<{backup_id:string;paper_count:number;project_count:number;workspace_revision:string}>("/backups/import-preview",{method:"POST",body:{archive}});
      setPreview(value);setNotice(tr("이전 자료를 확인했습니다. 아래에서 가져오기를 확정하세요.","Browser records checked. Confirm the import below."));
    }catch(e){setNotice(e instanceof Error?e.message:"Unable to prepare browser import");}finally{setBusy(false);}
  }
  async function restoreBrowser(){
    if(!preview||!window.confirm(tr("확인한 브라우저 자료를 현재의 빈 계정 공간에 가져올까요? 브라우저 원본은 유지됩니다.","Import the previewed browser records into this empty account workspace? The browser originals remain.")))return;
    setBusy(true);try{await labviumRequest(`/backups/${preview.backup_id}/restore`,{method:"POST",body:{expected_revision:preview.workspace_revision,confirm:true}});setPreview(null);resource.retry();setNotice(tr("계정으로 가져왔습니다. 같은 계정으로 다른 기기에서도 열 수 있습니다.","Imported to your account. Sign in with the same account on another device to open it."));}catch(e){setNotice(e instanceof Error?e.message:"Import failed; originals remain");}finally{setBusy(false);}
  }
  return <><Section title={tr("현재 계정의 저장 공간","Current account workspace")}><div className="lv-account-summary"><Cloud size={24}/><div><h2>{data.title==="Personal research"?tr("개인 연구 공간","Personal research"):data.title}</h2><p>{tr("서버에 저장된 내용은 같은 계정으로 다른 기기에서 열 수 있습니다.","Saved records are available on other devices signed in with the same account.")}</p></div></div><dl className="lv-metrics">{[[tr("논문","Papers"),data.paper_count],[tr("프로젝트","Projects"),data.project_count],[tr("연구 페이지","Research pages"),data.research_page_count],["PDF",data.pdf_count]].map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl><p className="muted-text">{tr("저장 시각","Last saved")}: {data.updated_at?new Date(data.updated_at).toLocaleString(ko?"ko-KR":"en-US"):tr("아직 저장 기록 없음","No saved changes yet")}</p><div className="lv-actions"><button className="reader-control reader-control--secondary" onClick={resource.retry}><RefreshCw size={15}/>{tr("저장 상태 확인","Refresh storage status")}</button><Link className="text-link" href="/team">{tr("개인·팀 공간 선택","Choose personal or team workspace")}</Link></div></Section>
  {hasBrowserData?<Section title={tr("이 브라우저에서 쓰던 자료 가져오기","Bring existing browser work into your account")} description={tr("로그인 전 이 브라우저에 저장했던 자료를 확인한 뒤 계정으로 옮깁니다. 원본은 브라우저에 남습니다.","Preview work saved here before signing in, then copy it into your account. Browser originals stay in place.")}>{empty&&getWorkspaceRole()!=="viewer"?<><p>{tr("PDF 합계 20MiB 이내의 자료를 가져올 수 있습니다. 가져오기 전에 논문·프로젝트 수를 확인합니다.","Imports support up to 20 MiB of PDF bytes. Review paper and project counts before confirming.")}</p><button className="reader-control reader-control--secondary" disabled={busy} onClick={()=>void previewBrowserImport()}>{tr("브라우저 자료 확인","Preview browser records")}</button>{preview?<div className="lv-notice"><p>{tr("논문","Papers")} {preview.paper_count} · {tr("프로젝트","Projects")} {preview.project_count}</p><button className="reader-control" disabled={busy} onClick={()=>void restoreBrowser()}>{tr("계정으로 가져오기 확정","Confirm import to account")}</button></div>:null}</>:<p>{tr("현재 공간에 자료가 있습니다. 팀 공간에서 새 빈 공간을 만든 뒤 여기로 돌아와 가져오세요. 기존 자료를 자동으로 합치거나 덮어쓰지 않습니다.","This workspace already contains records. Create and select a new empty workspace before importing. Existing data is not merged or overwritten automatically.")}</p>}</Section>:null}
  {notice?<p role="status" className="lv-notice">{notice}</p>:null}</>;
}
export function AccountView(){
  const{locale}=useI18n(),ko=locale==="ko",session=getWorkspaceSession(),cloud=getWorkspaceMode()==="cloud";
  return <div className="page-stack"><PageHeader title={ko?"계정과 저장":"Account and storage"} description={ko?"로그인한 계정과 저장 위치를 확인하세요.":"Check your signed-in account and where research is stored."}/><Section title={ko?"로그인 계정":"Signed-in account"}>{cloud?<><p><strong>{session?.user?.name||session?.user?.email||(ko?"로그인됨":"Signed in")}</strong></p>{session?.user?.name&&session?.user?.email?<p>{session.user.email}</p>:null}<a href="/signout-with-chatgpt?return_to=%2FLabVium" target="_top" className="text-link">{ko?"로그아웃":"Sign out"}</a></>:<><p>{ko?"ChatGPT 계정으로 로그인하면 연구 자료를 계정에 저장할 수 있습니다. 다른 기기에서도 같은 계정을 사용하세요.":"Sign in with your ChatGPT account to save research to your account. Use that same account on other devices."}</p><a className="reader-control" href="/signin-with-chatgpt?return_to=%2FLabVium" target="_top">{ko?"ChatGPT로 로그인":"Sign in with ChatGPT"}</a></>}</Section>{cloud?<CloudAccount/>:<Section title={ko?"현재는 브라우저 공간입니다":"You are using a browser workspace"}><p>{ko?"이 공간의 자료는 현재 브라우저에 저장됩니다. 로그인 후 ‘이 브라우저에서 쓰던 자료 가져오기’에서 계정으로 복사할 수 있습니다.":"Records stay in this browser. After signing in, use the browser import flow to copy them into an empty account workspace."}</p></Section>}<Section title={ko?"저장과 동기화 이용 안내":"How saving and updates work"}><div className="lv-account-summary"><ShieldCheck size={23}/><div><p>{ko?"편집 후 각 화면의 저장 버튼을 눌러 주세요. 다른 기기에서 저장한 변경은 상단에서 알려줍니다. 입력 중인 내용을 보호하기 위해 최신 저장본을 여는 동작은 직접 선택합니다.":"Use the save button after editing. The header announces updates from another session. Opening the latest version is an explicit action, so unfinished input is protected."}</p><Link href="/maintenance" className="text-link">{ko?"백업과 내보내기":"Backups and exports"}</Link></div></div></Section></div>;
}
