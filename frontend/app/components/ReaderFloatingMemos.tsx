"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, Grip, Link2, Pencil, Plus, Save, StickyNote } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ApiClientError, apiClient, getWorkspaceMode, getWorkspaceRole } from "../lib/api/client";
import type { EditableNoteBlockContent, NoteBlock, NoteBlockCollection } from "../lib/api/types";
import type { PdfPageSelection } from "../lib/pdf/selection-coordinates.mjs";
import type { ReaderHighlight } from "../lib/reader/browser-reader-state.mjs";
import { citedBlockHighlights, clampMemoPosition, decodeFloatingMemo, encodeFloatingMemo, floatingMemoDraft, type MemoPosition } from "../lib/reader/floating-memo.mjs";
import { memoSideFromPosition } from "../lib/reader/memo-layout.mjs";
import { readMemoVisibility, writeMemoVisibility, type MemoVisibility } from "../lib/reader/memo-visibility.mjs";
import { applyLatestRevisionDraft, beginRevisionSave, clearPersistentRevisionDraft, completeRevisionSave, createRevisionDraftState, draftStorageKey, editRevisionDraft, failRevisionSave, keepMyRevisionDraft, persistRevisionDraft, readPersistentRevisionDraft, receiveRemoteRevision, type RevisionDraftState } from "../lib/drafts/revision-draft.mjs";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { SaveStatus } from "./SaveStatus";
import { ReaderMemoConnections } from "./ReaderMemoConnections";
import "./ReaderAnnotations.css";

type MemoEditor = RevisionDraftState<EditableNoteBlockContent> & { blockId: string };
type Hosts = {workspace: HTMLElement; left: HTMLElement; right: HTMLElement; mobile: HTMLElement; layout: "side" | "bottom"; height: number};
type MemoCard = {id: string; block: NoteBlock | null; draft: EditableNoteBlockContent; text: string; position: MemoPosition};
const NEW_MEMO = "draft:new";
const INITIAL_VISIBILITY: MemoVisibility = {version: 1, hiddenAll: false, hiddenIds: []};
function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }
function draftKey(paperId: string, blockId = "") { return draftStorageKey("reader-floating-memo", `${paperId}:${blockId || "new"}`); }
function editable(block: NoteBlock): EditableNoteBlockContent {
  const { block_type, title, text, page, figure, quote, tags, provenance } = block;
  return { block_type, title, text, page, figure, quote, tags: [...tags], ...(provenance ? { provenance } : {}) };
}

export function ReaderFloatingMemos({ paperId, selection, refreshToken, mutationBusy, acquireMutation, releaseMutation, onSaved, onHighlights, onJumpToPage, onVisibilityChange }: {
  paperId: string; selection: PdfPageSelection | null; refreshToken: number; mutationBusy: boolean;
  acquireMutation: () => number | null; releaseMutation: (token: number) => void;
  onSaved: () => void; onHighlights: (highlights: ReaderHighlight[]) => void; onJumpToPage: (page: number) => void;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const { locale } = useI18n(); const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const [collection, setCollection] = useState<NoteBlockCollection | null>(null);
  const [editor, setEditor] = useState<MemoEditor | null>(null); const editorRef = useRef<MemoEditor | null>(null);
  const [memoEditors, setMemoEditors] = useState<Map<string,MemoEditor>>(() => new Map());
  const memoEditorsRef = useRef(new Map<string,MemoEditor>());
  const [expanded, setExpanded] = useState(false); const [listOpen, setListOpen] = useState(false);
  const [visibility, setVisibility] = useState<MemoVisibility>(INITIAL_VISIBILITY); const visibilityRef = useRef(visibility);
  const [message, setMessage] = useState(""); const [hosts, setHosts] = useState<Hosts | null>(null); const hostsRef = useRef(hosts);
  const [draggingId, setDraggingId] = useState("");
  const [cardHeights, setCardHeights] = useState<Record<string,number>>({});
  const rootRef = useRef<HTMLDivElement>(null); const triggerRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{pointerId: number; id: string; offsetY: number} | null>(null);
  const busyRef = useRef(false); const mounted = useRef(true);
  const writable = getWorkspaceMode() !== "local" && getWorkspaceRole() !== "viewer";
  const memos = collection?.items.filter(block => decodeFloatingMemo(block.text)) ?? [];
  const cardId = editor?.blockId || NEW_MEMO;
  const cards: MemoCard[] = memos.map(block => {
    const draft = memoEditors.get(block.id)?.draft || editable(block); const memo = decodeFloatingMemo(draft.text)!;
    return {id: block.id, block, draft, text: memo.text, position: memo.position};
  });
  for (const [id, retained] of memoEditors) if (!cards.some(card=>card.id===id)) { const memo=decodeFloatingMemo(retained.draft.text); if(memo)cards.push({id,block:null,draft:retained.draft,text:memo.text,position:memo.position}); }
  const visibleCards = visibility.hiddenAll ? [] : cards.filter(card => !visibility.hiddenIds.includes(card.id));
  const railsVisible = visibleCards.length > 0;

  useEffect(() => { mounted.current = true; let active = true; void Promise.resolve().then(() => { if (!active) return; const saved = readMemoVisibility(storage(), paperId); visibilityRef.current = saved.value; setVisibility(saved.value); if (!saved.ok) setMessage(saved.message); }); return () => { active = false; mounted.current = false; }; }, [paperId]);
  useEffect(() => { hostsRef.current = hosts; }, [hosts]);
  useEffect(() => { onVisibilityChange?.(railsVisible); }, [railsVisible, onVisibilityChange]);

  const updateEditor = useCallback((next: MemoEditor | null) => {
    const cache = new Map(memoEditorsRef.current);
    if(next)cache.set(next.blockId || NEW_MEMO,next);
    else if(editorRef.current)cache.delete(editorRef.current.blockId || NEW_MEMO);
    memoEditorsRef.current = cache; setMemoEditors(cache);
    editorRef.current = next; setEditor(next);
    if (next && !persistRevisionDraft(storage(), draftKey(paperId, next.blockId), next)) setMessage(locale === "ko" ? "임시 메모를 이 기기에 기억하지 못했습니다. 떠나기 전에 메모를 저장해주세요." : "The draft could not be kept on this device. Save the memo before leaving.");
  }, [paperId, locale]);
  function changeVisibility(next: MemoVisibility) {
    const result = writeMemoVisibility(storage(), paperId, next); visibilityRef.current = next; setVisibility(next);
    if (!result.ok) setMessage(tr("숨김은 현재 화면에 적용했지만 이 기기에 기억하지 못했습니다. 메모 내용은 유지됩니다.", "Visibility changed for this view, but could not be remembered on this device. Memo content is retained."));
  }
  function showCard(id: string) { changeVisibility({...visibilityRef.current, hiddenAll: false, hiddenIds: visibilityRef.current.hiddenIds.filter(value => value !== id)}); }
  function hideCard(id: string) { changeVisibility({...visibilityRef.current, hiddenIds: [...new Set([...visibilityRef.current.hiddenIds, id])]}); if (cardId === id) setExpanded(false); triggerRef.current?.focus(); }

  useEffect(() => {
    let active = true;
    apiClient.getNoteBlocks(paperId).then(value => {
      if (!active) return; setCollection(value); onHighlights(citedBlockHighlights(value.items, paperId));
      const current = editorRef.current;
      const cache = new Map(memoEditorsRef.current);
      for(const [id,cached] of cache)if(id!==NEW_MEMO && id!==current?.blockId && !value.items.some(block=>block.id===id) && cached.saveState==="saved") { cache.delete(id);clearPersistentRevisionDraft(storage(),draftKey(paperId,id)); }
      for(const block of value.items.filter(item=>decodeFloatingMemo(item.text))) {
        if(block.id===current?.blockId)continue;
        const cached=cache.get(block.id);
        if(cached && !cached.activeSave)cache.set(block.id,receiveRemoteRevision(cached,{value:editable(block),revision:value.note_blocks_revision}));
        else if(!cached) { const record=readPersistentRevisionDraft(storage(),draftKey(paperId,block.id)); if(record)cache.set(block.id,{...createRevisionDraftState({draft:editable(block),revision:value.note_blocks_revision,record}),blockId:block.id}); }
      }
      memoEditorsRef.current = cache; setMemoEditors(cache);
      if (current && !current.activeSave) {
        const remote = current.blockId ? value.items.find(block => block.id === current.blockId) : null;
        if (remote || !current.blockId) updateEditor(receiveRemoteRevision(current, {value: remote ? editable(remote) : current.baseline, revision: value.note_blocks_revision}));
        else if (current.saveState === "saved") { clearPersistentRevisionDraft(storage(), draftKey(paperId, current.blockId)); updateEditor(null); }
      } else if (!current) {
        const record = readPersistentRevisionDraft(storage(), draftKey(paperId));
        if (record) {
          const restored = {...createRevisionDraftState({draft: floatingMemoDraft(), revision: value.note_blocks_revision, record}), blockId: ""};
          if (decodeFloatingMemo(restored.draft.text)) { updateEditor(restored); setExpanded(true); }
        }
      }
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : "Notes could not be loaded."); });
    return () => { active = false; };
  }, [paperId, refreshToken, onHighlights, updateEditor]);

  useEffect(() => {
    const reader = rootRef.current?.closest(".pdfjs-reader"); if (!reader) return;
    let resize: ResizeObserver | null = null;
    const sync = () => {
      const workspace = reader.querySelector<HTMLElement>(".reader-document-workspace");
      const left = workspace?.querySelector<HTMLElement>('[data-memo-rail="left"]'); const right = workspace?.querySelector<HTMLElement>('[data-memo-rail="right"]'); const mobile = workspace?.querySelector<HTMLElement>('[data-memo-rail="mobile"]');
      if (!workspace || !left || !right || !mobile) return;
      resize?.observe(workspace); resize?.observe(left); resize?.observe(mobile);
      const layout = workspace.dataset.memoLayout === "side" ? "side" : "bottom";
      const height = Math.max(120, (layout === "side" ? left : mobile).clientHeight || 400);
      setHosts(current => current?.workspace === workspace && current.layout === layout && current.height === height ? current : {workspace, left, right, mobile, layout, height});
    };
    sync(); const mutations = new MutationObserver(sync); mutations.observe(reader, {childList:true, subtree:true, attributes:true, attributeFilter:["data-memo-layout", "data-memo-visible"]});
    resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync); resize?.observe(reader); sync();
    return () => { mutations.disconnect(); resize?.disconnect(); };
  }, [paperId]);

  const visibleKey = visibleCards.map(card=>card.id).join("|");
  useEffect(() => {
    if (!hosts || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      setCardHeights(current => { let next=current; for(const entry of entries) { const element=entry.target as HTMLElement; const id=element.dataset.memoConnectorId; const height=entry.borderBoxSize?.[0]?.blockSize || element.getBoundingClientRect().height; if(id && Math.abs((current[id] || 0)-height)>.5) { if(next===current)next={...current};next[id]=height; } } return next; });
    });
    for (const note of hosts.workspace.querySelectorAll<HTMLElement>("[data-memo-connector-id]")) observer.observe(note);
    return () => observer.disconnect();
  }, [hosts,visibleKey]);

  function openMemo(block: NoteBlock | null = null, expand = true, retainedId?: string): MemoEditor | null {
    if (!collection || busyRef.current) return null;
    const id = retainedId || block?.id || NEW_MEMO; showCard(id); setListOpen(false); setExpanded(expand);
    if ((editorRef.current?.blockId || NEW_MEMO)===id && editorRef.current) return editorRef.current;
    const cached=memoEditorsRef.current.get(id);if(cached){updateEditor(cached);return cached;}
    let baseline = block ? editable(block) : floatingMemoDraft(selection);
    if (!block) { const leftCount = memos.filter(memo => memoSideFromPosition(decodeFloatingMemo(memo.text)!.position) === "left").length; const rightCount = memos.length - leftCount; baseline = {...baseline, text: encodeFloatingMemo("", {x: leftCount <= rightCount ? 0 : 1, y: Math.min(.8, .025 + Math.min(leftCount,rightCount) * .2)})}; }
    const next = {...createRevisionDraftState({draft: baseline, revision: collection.note_blocks_revision, record: readPersistentRevisionDraft(storage(), draftKey(paperId, block?.id))}), blockId: block?.id || ""};
    updateEditor(next); setMessage(""); return next;
  }
  function edit(fields: Partial<EditableNoteBlockContent>) { const current = editorRef.current; if (writable && current) updateEditor(editRevisionDraft(current, {...current.draft,...fields})); }
  function move(position: MemoPosition) { const current = editorRef.current; const memo = current ? decodeFloatingMemo(current.draft.text) : null; if (writable && memo) edit({text: encodeFloatingMemo(memo.text, clampMemoPosition(position))}); }
  function beginDrag(event: PointerEvent<HTMLButtonElement>, card: MemoCard) {
    if (!writable || busyRef.current || event.button !== 0 || hosts?.layout !== "side") return;
    if (!openMemo(card.block, false,card.id)) return; event.preventDefault();
    const note = event.currentTarget.closest<HTMLElement>(".reader-sticky-note"); drag.current = {pointerId: event.pointerId, id: card.id, offsetY: event.clientY - (note?.getBoundingClientRect().top || event.clientY)}; setDraggingId(card.id);
  }
  useEffect(() => {
    let frame: number | null = null; let point: {x:number;y:number} | null = null;
    const apply = () => {
      frame = null; const active = drag.current, host = hostsRef.current, current = editorRef.current;
      if (!active || !host || !current || !point) return;
      const memo = decodeFloatingMemo(current.draft.text); if (!memo) return;
      const workspace = host.workspace.getBoundingClientRect(); const side = point.x < workspace.left + workspace.width / 2 ? "left" : "right"; const rail = host[side]; const rect = rail.getBoundingClientRect();
      const y = (point.y - rect.top + rail.scrollTop - active.offsetY) / Math.max(80, host.height - 180);
      updateEditor(editRevisionDraft(current, {...current.draft, text: encodeFloatingMemo(memo.text, clampMemoPosition({x: side === "left" ? 0 : 1, y}))}));
    };
    const pointerMove = (event: globalThis.PointerEvent) => { if (drag.current?.pointerId !== event.pointerId) return; point = {x:event.clientX,y:event.clientY}; if (frame === null) frame = window.requestAnimationFrame(apply); };
    const stop = (event: globalThis.PointerEvent) => { if (drag.current?.pointerId !== event.pointerId) return; if(event.type!=="pointercancel")point = {x:event.clientX,y:event.clientY}; if (frame !== null) window.cancelAnimationFrame(frame); apply(); drag.current = null; setDraggingId(""); };
    window.addEventListener("pointermove",pointerMove); window.addEventListener("pointerup",stop); window.addEventListener("pointercancel",stop);
    return () => { window.removeEventListener("pointermove",pointerMove); window.removeEventListener("pointerup",stop); window.removeEventListener("pointercancel",stop); if (frame !== null) window.cancelAnimationFrame(frame); drag.current = null; };
  }, [updateEditor]);
  function keyboardMove(event: KeyboardEvent<HTMLButtonElement>, card: MemoCard) {
    if (!writable || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return; event.preventDefault(); if (!openMemo(card.block, expanded && cardId === card.id,card.id)) return;
    move({x:event.key === "ArrowLeft" ? 0 : event.key === "ArrowRight" ? 1 : card.position.x,y:card.position.y + (event.key === "ArrowUp" ? -.04 : event.key === "ArrowDown" ? .04 : 0)});
  }

  async function save() {
    const current = editorRef.current; if (!current || busyRef.current || mutationBusy || !writable || !decodeFloatingMemo(current.draft.text)?.text.trim()) return;
    if ((current.draft.provenance?.rectangles.length || 0) > 200) { setMessage(tr("더 짧은 원문 구간을 선택해주세요.", "Select a shorter source excerpt.")); return; }
    const started = beginRevisionSave(current); if (!started.request) return; const token = acquireMutation(); if (token === null) return;
    busyRef.current = true; updateEditor(started.state); setMessage(""); const request = started.request;
    try {
      const response = current.blockId ? await apiClient.updateNoteBlock(paperId,current.blockId,request.draft,request.revision) : await apiClient.createNoteBlock(paperId,request.draft,request.revision);
      if (!mounted.current || !editorRef.current) return;
      const next = {...completeRevisionSave(editorRef.current,request.token,{value:editable(response.block),revision:response.note_blocks_revision}),blockId:response.block.id}; updateEditor(next);
      if (!current.blockId) { const cache = new Map(memoEditorsRef.current); cache.delete(NEW_MEMO); memoEditorsRef.current = cache; setMemoEditors(cache); clearPersistentRevisionDraft(storage(),draftKey(paperId)); if (visibilityRef.current.hiddenIds.includes(NEW_MEMO)) changeVisibility({...visibilityRef.current,hiddenIds:[...visibilityRef.current.hiddenIds.filter(id=>id!==NEW_MEMO),response.block.id]}); }
      setCollection(previous => previous ? {...previous,items:[...previous.items.filter(block=>block.id!==response.block.id),response.block],note_blocks_revision:response.note_blocks_revision} : previous);
      setMessage(tr(next.saveState === "saved" ? "메모와 위치 저장 완료 ✔️" : "저장 완료 · 새로 입력한 내용은 아직 임시 메모입니다.",next.saveState === "saved" ? "Memo and position saved ✔️" : "Saved · newer edits remain in your draft.")); onSaved();
    } catch(error) {
      if (!mounted.current || !editorRef.current) return;
      let latest: NoteBlockCollection | null=null;
      if (error instanceof ApiClientError && error.kind === "conflict") { try { latest=await apiClient.getNoteBlocks(paperId); } catch { /* Preserve the exact local draft. */ } }
      if(!mounted.current || !editorRef.current)return;
      let failed = failRevisionSave(editorRef.current,request.token,error instanceof ApiClientError ? error.kind : "error");
      if(latest){setCollection(latest);const block=latest.items.find(item=>item.id===current.blockId);if(block || !current.blockId)failed=receiveRemoteRevision(failed,{value:block ? editable(block):current.baseline,revision:latest.note_blocks_revision,changedElsewhere:true});}
      updateEditor(failed); setMessage(tr("저장하지 못했습니다. 임시 메모는 유지됩니다.","Save failed. Your draft is retained."));
    } finally { busyRef.current=false;releaseMutation(token); }
  }

  const topById = new Map<string,number>(); const cursors={left:8,right:8};
  for (const card of [...visibleCards].sort((a,b)=>a.position.y-b.position.y)) { const side=memoSideFromPosition(card.position); const desired=Math.max(8,card.position.y*Math.max(80,(hosts?.height || 400)-180)); const top=draggingId===card.id ? desired : Math.max(desired,cursors[side]); topById.set(card.id,top); cursors[side]=top+(cardHeights[card.id] || (cardId===card.id && expanded ? 470:260))+14; }
  const sticky = (card: MemoCard) => {
    const active = cardId===card.id && editor; const isExpanded=Boolean(active && expanded); const side=memoSideFromPosition(card.position); const cachedEditor=memoEditors.get(card.id); const dirty=Boolean(cachedEditor && cachedEditor.saveState!=="saved");
    return <aside key={card.id} className={`reader-sticky-note${isExpanded ? " is-editing":""}${draggingId===card.id ? " is-dragging":""}`} data-memo-connector-id={card.id} data-memo-paper-id={paperId} data-memo-side={hosts?.layout==="bottom" ? "bottom":side} aria-label={card.draft.title || tr("노란 포스트잇 메모","Yellow sticky note")} style={hosts?.layout==="side" ? {top:topById.get(card.id) || 8}:undefined} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();hideCard(card.id);}}}>
      <header className="reader-sticky-note__header"><button className="reader-memo-grip" type="button" disabled={!writable} aria-label={tr("메모 이동: 드래그하거나 방향키를 사용하세요","Move memo: drag or use arrow keys")} title={tr("드래그하여 양옆으로 이동 · 방향키 지원","Drag between margins · arrow keys supported")} onPointerDown={event=>beginDrag(event,card)} onKeyDown={event=>keyboardMove(event,card)}><Grip size={15}/><span>{tr("메모","Memo")}</span></button><button className="reader-sticky-note__icon" type="button" aria-label={tr("메모 숨기기 · 내용 유지","Hide memo and keep content")} title={tr("메모 숨기기","Hide memo")} onClick={()=>hideCard(card.id)}><EyeOff size={15}/></button></header>
      <div className="reader-sticky-note__body">
        {card.draft.provenance?.source==="pdf_selection" ? <button className="reader-sticky-note__source" type="button" onClick={()=>onJumpToPage(Number(card.draft.page))}><Link2 size={13}/>{tr(`원문 ${card.draft.page}쪽`,`Source p. ${card.draft.page}`)}</button> : <span className="reader-sticky-note__source">{tr("자유 메모","Free note")}</span>}
        {isExpanded && editor ? <>
          <label className="reader-field"><span>{tr("제목","Title")}</span><input value={editor.draft.title} maxLength={200} disabled={!writable} onChange={event=>edit({title:event.target.value})} placeholder={tr("새로 알게 된 점","What I learned")}/></label>
          <label className="reader-field"><span>{tr("내 해석과 지식","My interpretation")}</span><textarea rows={5} value={card.text} maxLength={95000} disabled={!writable} onChange={event=>edit({text:encodeFloatingMemo(event.target.value,card.position)})} placeholder={tr("핵심 개념과 질문을 적어보세요.","Record a key concept or question.")}/></label>
          {!editor.draft.provenance && collection?.items.some(block=>block.provenance?.source==="pdf_selection") ? <label className="reader-field"><span>{tr("기존 하이라이트와 연결","Link to a saved highlight")}</span><select value="" disabled={!writable} onChange={event=>{const source=collection.items.find(block=>block.id===event.target.value);if(source?.provenance)edit({page:source.page,quote:source.provenance.quote,provenance:structuredClone(source.provenance)});}}><option value="">{tr("연결할 구간 선택","Choose an excerpt")}</option>{collection.items.filter(block=>block.provenance?.source==="pdf_selection").map(block=><option value={block.id} key={block.id}>{block.page} · {(block.title || block.quote).slice(0,55)}</option>)}</select></label> : null}
          {card.draft.quote ? <details><summary>{tr("연결한 원문 보기","Linked source excerpt")}</summary><blockquote>{card.draft.quote}</blockquote></details> : null}
          {editor.saveState==="changed_elsewhere" ? <div className="reader-sticky-note__conflict"><p>{tr("다른 곳에서 변경됐어요. 내 임시 메모는 유지됩니다.","Changed elsewhere. Your draft is retained.")}</p><button className="text-link" type="button" disabled={editor.remoteRevision===editor.revision} onClick={()=>updateEditor(keepMyRevisionDraft(editor))}>{tr("내 임시 메모 유지","Keep my draft")}</button><button className="text-link" type="button" onClick={()=>{if(window.confirm(tr("최근 저장본으로 바꿀까요? 현재 임시 메모가 교체됩니다.","Replace this draft with the latest saved version?")))updateEditor(applyLatestRevisionDraft(editor));}}>{tr("최근 저장본 사용","Use latest saved version")}</button><details><summary>{tr("내 메모와 저장본 비교","Compare draft and saved version")}</summary><pre>{card.text}</pre><hr/><pre>{decodeFloatingMemo(editor.remote.text)?.text || editor.remote.text}</pre></details></div> : null}
        </> : <><h3>{card.draft.title || tr("제목 없는 메모","Untitled memo")}</h3><p className="reader-sticky-note__text">{card.text || tr("이곳에 생각을 적어보세요.","Capture your thoughts here.")}</p></>}
        <div className="reader-sticky-note__actions"><button className="text-link" type="button" disabled={Boolean(editor?.activeSave)} onClick={()=>{if(active && expanded)setExpanded(false);else openMemo(card.block,true,card.id);}}><Pencil size={13}/>{isExpanded ? tr("접기","Collapse"):tr(writable ? "편집":"열기",writable ? "Edit":"Open")}</button>{!active && dirty ? <span className="reader-sticky-note__unsaved">{tr("저장 전 변경 있음","Unsaved changes")}</span> : null}{active ? <><SaveStatus state={editor.saveState}/><button className="reader-control" type="button" disabled={!writable || mutationBusy || Boolean(editor.activeSave) || !dirty || editor.saveState==="changed_elsewhere" || !card.text.trim()} onClick={()=>void save()}><Save size={13}/>{tr("저장","Save")}</button></> : null}</div>
        <div className="reader-sticky-note__dock"><button type="button" className="reader-sticky-note__icon" aria-label={tr("왼쪽 여백으로 이동","Move to left margin")} disabled={!writable || Boolean(editor?.activeSave)} onClick={()=>{if(openMemo(card.block,isExpanded,card.id))move({...card.position,x:0});}}><ArrowLeft size={13}/></button><span>{tr(side==="left" ? "왼쪽 여백":"오른쪽 여백",side==="left" ? "Left margin":"Right margin")}</span><button type="button" className="reader-sticky-note__icon" aria-label={tr("오른쪽 여백으로 이동","Move to right margin")} disabled={!writable || Boolean(editor?.activeSave)} onClick={()=>{if(openMemo(card.block,isExpanded,card.id))move({...card.position,x:1});}}><ArrowRight size={13}/></button></div>
      </div>
    </aside>;
  };
  return <div ref={rootRef} className="reader-floating-memos" data-memo-paper-id={paperId}>
    <div className="reader-annotation-tools">
      <button ref={triggerRef} className="reader-control reader-control--secondary" type="button" disabled={!collection || !writable} onClick={()=>openMemo()}><Plus size={15}/>{tr(selection ? "선택 구간에 포스트잇":"새 포스트잇",selection ? "Sticky note on selection":"New sticky note")}</button>
      <button className="reader-control reader-control--secondary" type="button" aria-expanded={listOpen} onClick={()=>setListOpen(value=>!value)}><StickyNote size={15}/>{tr(`메모 ${cards.length}개`,`Memos (${cards.length})`)}</button>
      <button className="reader-control reader-control--secondary" type="button" aria-pressed={visibility.hiddenAll} disabled={!cards.length} onClick={()=>changeVisibility({...visibilityRef.current,hiddenAll:!visibilityRef.current.hiddenAll})}>{visibility.hiddenAll ? <Eye size={15}/>:<EyeOff size={15}/>} {tr(visibility.hiddenAll ? "메모 표시":"전체 메모 숨기기",visibility.hiddenAll ? "Show memos":"Hide all memos")}</button>
      {visibility.hiddenIds.length ? <span className="reader-memo-hidden-count">{tr(`개별 숨김 ${cards.filter(card=>visibility.hiddenIds.includes(card.id)).length}개`,`Individually hidden: ${cards.filter(card=>visibility.hiddenIds.includes(card.id)).length}`)}</span> : null}
    </div>
    {listOpen ? <div className="reader-memo-list" aria-label={tr("포스트잇 목록 · 숨긴 메모 다시 열기","Sticky notes · reopen hidden memos")}>{cards.length ? cards.map(card=><div key={card.id}><button className="text-link" type="button" onClick={()=>openMemo(card.block,true,card.id)}>{card.draft.title || tr("제목 없는 메모","Untitled memo")}{card.draft.page ? ` · p. ${card.draft.page}`:""}</button><button className="reader-sticky-note__icon" type="button" aria-label={tr(visibility.hiddenAll || visibility.hiddenIds.includes(card.id) ? "이 메모 다시 표시":"이 메모 숨기기",visibility.hiddenAll || visibility.hiddenIds.includes(card.id) ? "Show this memo":"Hide this memo")} onClick={()=>visibility.hiddenAll || visibility.hiddenIds.includes(card.id) ? showCard(card.id):hideCard(card.id)}>{visibility.hiddenAll || visibility.hiddenIds.includes(card.id) ? <Eye size={15}/>:<EyeOff size={15}/>}</button></div>) : <p>{tr("저장한 포스트잇이 없습니다.","No saved sticky notes yet.")}</p>}</div> : null}
    {message ? <p role="status" className="reader-editor__status reader-memo-status">{message}</p> : null}
    {hosts ? visibleCards.map(card=>createPortal(sticky(card),hosts.layout==="bottom" ? hosts.mobile:hosts[memoSideFromPosition(card.position)],card.id)) : null}
    <ReaderMemoConnections paperId={paperId} items={visibleCards.map(card=>({id:card.id,provenance:card.draft.provenance}))} visible={railsVisible}/>
  </div>;
}
