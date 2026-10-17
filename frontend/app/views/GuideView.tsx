"use client";
import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { GUIDE_EDITION, GUIDE_SECTIONS } from "../lib/continuity/guide.mjs";
import { useI18n } from "../lib/i18n/LocaleProvider";
export function GuideView(){
  const {locale}=useI18n(),ko=locale==="ko";
  function jump(event:React.MouseEvent<HTMLAnchorElement>,id:string){event.preventDefault();document.getElementById(`guide-${id}`)?.scrollIntoView({behavior:"instant",block:"start"});}
  return <div className="page-stack lv-guide"><PageHeader title={ko?"LabVium 사용 안내":"LabVium user guide (Korean)"} description={`${GUIDE_EDITION} · ${ko?"처음 시작하는 연구자와 연구실 운영자를 위한 안내":"Getting started and workspace operations"}`} actions={<a className="reader-control reader-control--secondary" href="/ku-ai/help/LabVium_User_Guide_KO.pdf" download><Download size={15}/>{ko?"PDF 안내서":"PDF guide"}</a>}/><nav className="lv-guide-index" aria-label={ko?"사용 안내 목차":"Guide contents"}>{GUIDE_SECTIONS.map((s,index)=><a key={s.id} href={`#guide-${s.id}`} onClick={event=>jump(event,s.id)}><span>{String(index+1).padStart(2,"0")}</span>{s.title}</a>)}</nav>{GUIDE_SECTIONS.map((s,index)=><div id={`guide-${s.id}`} key={s.id} className="lv-guide-chapter"><Section title={`${String(index+1).padStart(2,"0")}  ${s.title}`} description={s.lead}><ol>{s.steps.map(step=><li key={step}>{step}</li>)}</ol><p className="lv-guide-note">{s.note}</p></Section></div>)}<div className="lv-actions"><Link className="reader-control" href="/projects">{ko?"프로젝트 열기":"Open projects"}</Link><Link className="text-link" href="/account">{ko?"계정과 저장 확인":"Check account storage"}</Link></div></div>;
}
