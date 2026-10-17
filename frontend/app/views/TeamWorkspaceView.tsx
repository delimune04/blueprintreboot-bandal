"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { getWorkspaceMode, getWorkspaceScope, labviumRequest, switchWorkspace } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";

type Workspace = { workspace_id: string; title: string; role: "owner" | "editor" | "viewer"; permissions_revision: string };
type Member = { member_id: string; email: string; role: "viewer" | "editor"; created_at: string };
export function TeamWorkspaceView() {
  const { locale } = useI18n();
  const tr = useCallback((ko: string, en: string) => locale === "ko" ? ko : en, [locale]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [permissionsRevision, setPermissionsRevision] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [personalId, setPersonalId] = useState("");
  const [transferEmail, setTransferEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const serial = useRef(0);
  const cloud = getWorkspaceMode() === "cloud";
  const current = workspaces.find((row) => row.workspace_id === getWorkspaceScope());
  const refresh = useCallback(async () => {
    const token = ++serial.current;
    try {
      const result = await labviumRequest<{ items: Workspace[]; personal_workspace_id:string }>("/workspaces");
      if (token !== serial.current) return;
      setWorkspaces(result.items);
      setPersonalId(result.personal_workspace_id);
      const selected = result.items.find((row) => row.workspace_id === getWorkspaceScope());
      if (selected?.role === "owner") {
        const response = await labviumRequest<{ items: Member[]; permissions_revision: string }>(`/workspaces/${selected.workspace_id}/members`);
        if (token !== serial.current) return;
        setMembers(response.items); setPermissionsRevision(response.permissions_revision);
      } else { setMembers([]); setPermissionsRevision(""); }
    } catch (error) { if (token === serial.current) setNotice(error instanceof Error ? error.message : "Workspace access unavailable"); }
  }, []);
  const invalidate = useCallback(() => { serial.current++; }, []);
  useEffect(() => {
    let active = true;
    if (cloud) queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; invalidate(); };
  }, [cloud, refresh, invalidate]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!title.trim() || busy) return;
    setBusy(true); setNotice("");
    try { await labviumRequest("/workspaces", { method: "POST", body: { title: title.trim() } }); setTitle(""); await refresh(); setNotice(tr("새 공간을 만들었습니다. 아래 목록에서 선택해 열어주세요.", "Workspace created. Select it from the list below.")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Workspace could not be created"); }
    finally { setBusy(false); }
  }
  async function grant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!current || !email.trim() || busy) return;
    const message = tr(`${email.trim()} 계정에 이 공간의 ${role === "viewer" ? "읽기" : "편집"} 권한을 부여할까요? 이 공간의 모든 논문과 노트를 볼 수 있습니다.`, `Grant ${role} access to ${email.trim()}? This includes all papers and notes in this workspace.`);
    if (!window.confirm(message)) return;
    setBusy(true); setNotice("");
    try { await labviumRequest(`/workspaces/${current.workspace_id}/members`, { method: "POST", body: { email: email.trim(), role, expected_revision: permissionsRevision, confirm: true } }); setEmail(""); await refresh(); setNotice(tr("해당 이메일로 로그인하면 접근할 수 있습니다. 초대 메일은 보내지 않았습니다.", "This email can access the workspace after signing in. No invitation email was sent.")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Access could not be granted"); }
    finally { setBusy(false); }
  }
  async function revoke(member: Member) {
    if (!current || busy || !window.confirm(tr(`${member.email}의 접근 권한을 회수할까요?`, `Revoke ${member.email}'s access?`))) return;
    setBusy(true); setNotice("");
    try { await labviumRequest(`/workspaces/${current.workspace_id}/members/${member.member_id}`, { method: "DELETE", body: { expected_revision: permissionsRevision, confirm: true } }); await refresh(); setNotice(tr("접근 권한을 회수했습니다.", "Access revoked.")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Access could not be revoked"); }
    finally { setBusy(false); }
  }
  function open(row: Workspace) {
    if (row.workspace_id === current?.workspace_id) return;
    if (!window.confirm(tr("다른 연구 공간을 열까요? 저장하지 않은 편집 내용은 먼저 저장해주세요. 논문·노트는 공간별로 구분됩니다.", "Open another workspace? Save unsaved edits first. Papers and notes remain separate by workspace."))) return;
    try { switchWorkspace(row.workspace_id); } catch { setNotice(tr("공간 선택을 저장하지 못했습니다. 브라우저 저장 권한을 확인해주세요.", "Could not remember the selected workspace. Check browser storage permissions.")); }
  }
  async function transfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || current.workspace_id === personalId || busy || !transferEmail.trim()) return;
    if (!window.confirm(tr(`${transferEmail.trim()} 계정에 이 팀 공간의 소유권을 이전할까요? 상대방은 이미 이 공간에 로그인해 참여한 구성원이어야 합니다. 이전 후 내 권한은 편집자로 바뀝니다.`, `Transfer ownership to ${transferEmail.trim()}? The recipient must already have joined. You will retain editor access.`))) return;
    setBusy(true);setNotice("");
    try { await labviumRequest(`/workspaces/${current.workspace_id}/transfer`, { method:"POST", body:{email:transferEmail.trim(),expected_revision:permissionsRevision,confirm:true} }); window.location.reload(); }
    catch(error){ setNotice(error instanceof Error ? error.message : "Ownership could not be transferred");setBusy(false); }
  }
  return <div className="page-stack"><PageHeader title={tr("개인 공간과 연구실 공간", "Personal and team workspaces")} description={tr("개인 공부 자료는 따로 보관하고, 연구실이나 회사의 자료는 선택한 공간에서 공유합니다.", "Keep personal study private and share selected work in a separate lab or company workspace.")} />
    {!cloud ? <Section title={tr("로그인 후 공유 공간을 사용할 수 있습니다", "Sign in to use shared workspaces")}><p>{tr("현재 브라우저 공간은 이 기기에만 저장됩니다. 공유 자료는 로그인한 계정과 공간 권한으로 보호됩니다.", "The current browser workspace is device-local. Shared research is protected by account and workspace permissions.")}</p><a className="reader-control" target="_top" href="/signin-with-chatgpt?return_to=%2Fku-ai%2F">{tr("로그인", "Sign in")}</a></Section> : <>
      <Section title={tr("내가 접근할 수 있는 공간", "Available workspaces")}><div className="lab-discovery-list">{workspaces.map((row) => <article className="lab-discovery-row" key={row.workspace_id}><h2>{row.title === "Personal research" ? tr("개인 연구 공간", "Personal research") : row.title}</h2><p>{tr(row.role === "owner" ? "소유자" : row.role === "editor" ? "편집 가능" : "읽기 전용", row.role)}{row.workspace_id === current?.workspace_id ? tr(" · 현재 공간", " · Current workspace") : ""}</p><button className="reader-control reader-control--secondary" onClick={() => open(row)} disabled={busy || row.workspace_id === current?.workspace_id}>{tr("이 공간 열기", "Open workspace")}</button></article>)}</div></Section>
      <Section title={tr("별도의 연구실·회사 공간 만들기", "Create a separate lab or company workspace")}><form className="lab-discover-form" onSubmit={(event) => void create(event)}><label className="reader-field"><span>{tr("공간 이름", "Workspace name")}</span><input required value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder={tr("예: CCS 연구실", "e.g. CCS research team")} /></label><button className="reader-control" disabled={busy || !title.trim()}>{tr("공간 만들기", "Create workspace")}</button></form><p>{tr("새 공간은 비어 있으며, 기존 개인 자료를 자동으로 옮기거나 공유하지 않습니다.", "A new workspace starts empty. Existing personal material is not moved or shared automatically.")}</p></Section>
      {current?.role === "owner" ? <Section title={tr("현재 공간의 접근 권한", "Access to the current workspace")}><form className="lab-discover-form" onSubmit={(event) => void grant(event)}><label className="reader-field"><span>{tr("함께 사용할 사람의 이메일", "Member email")}</span><input type="email" required value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} /></label><label className="reader-field"><span>{tr("권한", "Role")}</span><select value={role} onChange={(event) => setRole(event.target.value as "viewer" | "editor")}><option value="viewer">{tr("읽기 전용", "Read only")}</option><option value="editor">{tr("읽기·편집", "Read and edit")}</option></select></label><button className="reader-control" disabled={busy || !email.trim() || !permissionsRevision}>{tr("접근 권한 부여", "Grant access")}</button></form><p className="muted-text">{tr("이 공간의 자료 전체에 적용됩니다. 해당 이메일의 로그인 계정을 확인한 뒤 권한이 연결됩니다.", "Access applies to all material in this workspace and is linked to the signed-in account for that email.")}</p>{members.map((member) => <div className="lab-result-actions" key={member.member_id}><span>{member.email} · {tr(member.role === "viewer" ? "읽기 전용" : "읽기·편집", member.role)}</span><button className="reader-control reader-control--secondary" onClick={() => void revoke(member)} disabled={busy}>{tr("권한 회수", "Revoke")}</button></div>)}</Section> : <Section title={tr("권한 안내", "Access information")}><p>{tr("공간 소유자가 접근 권한을 관리합니다. 읽기 전용 계정의 저장 요청은 서버에서 차단됩니다.", "The workspace owner manages access. Read-only accounts cannot save changes on the server.")}</p></Section>}
      {current?.role === "owner" && personalId && current.workspace_id !== personalId ? <Section title={tr("팀 공간 소유권 이전", "Transfer team ownership")} description={tr("졸업·퇴사 등 담당자 변경 시 사용합니다. 먼저 상대방에게 접근 권한을 부여하고, 상대방이 로그인해 공간에 참여한 뒤 진행하세요.", "Use this when a team owner changes. Grant access first and ask the recipient to sign in and join before transferring.")}><form className="lab-discover-form" onSubmit={event=>void transfer(event)}><label className="reader-field"><span>{tr("새 소유자의 이메일", "New owner's email")}</span><input type="email" required value={transferEmail} maxLength={254} onChange={event=>setTransferEmail(event.target.value)}/></label><button className="reader-control reader-control--secondary" disabled={busy || !transferEmail.trim() || !permissionsRevision}>{tr("소유권 이전", "Transfer ownership")}</button></form><p className="muted-text">{tr("자료와 파일은 같은 공간에 유지되며, 기존 소유자는 편집자로 남습니다. 개인 연구 공간은 이전할 수 없습니다.", "Records and files stay in this workspace. The previous owner becomes an editor. Personal workspaces cannot be transferred.")}</p></Section> : null}
    </>}{notice ? <p role="status" className="reader-editor__status">{notice}</p> : null}</div>;
}
