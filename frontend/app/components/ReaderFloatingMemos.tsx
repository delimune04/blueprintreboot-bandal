"use client";

import { Grip, Plus, Save, StickyNote, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ApiClientError, apiClient, getWorkspaceMode, getWorkspaceRole } from "../lib/api/client";
import type { EditableNoteBlockContent, NoteBlock, NoteBlockCollection } from "../lib/api/types";
import type { PdfPageSelection } from "../lib/pdf/selection-coordinates.mjs";
import type { ReaderHighlight } from "../lib/reader/browser-reader-state.mjs";
import { citedBlockHighlights, clampMemoPosition, decodeFloatingMemo, encodeFloatingMemo, floatingMemoDraft, type MemoPosition } from "../lib/reader/floating-memo.mjs";
import { applyLatestRevisionDraft, beginRevisionSave, clearPersistentRevisionDraft, completeRevisionSave, createRevisionDraftState, draftStorageKey, editRevisionDraft, failRevisionSave, keepMyRevisionDraft, persistRevisionDraft, readPersistentRevisionDraft, receiveRemoteRevision, type RevisionDraftState } from "../lib/drafts/revision-draft.mjs";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { SaveStatus } from "./SaveStatus";
import "./ReaderAnnotations.css";

type MemoEditor = RevisionDraftState<EditableNoteBlockContent> & { blockId: string };
function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }
function draftKey(paperId: string, blockId = "") { return draftStorageKey("reader-floating-memo", `${paperId}:${blockId || "new"}`); }
function editable(block: NoteBlock): EditableNoteBlockContent {
  const { block_type, title, text, page, figure, quote, tags, provenance } = block;
  return { block_type, title, text, page, figure, quote, tags: [...tags], ...(provenance ? { provenance } : {}) };
}

export function ReaderFloatingMemos({ paperId, selection, refreshToken, mutationBusy, acquireMutation, releaseMutation, onSaved, onHighlights, onJumpToPage }: {
  paperId: string; selection: PdfPageSelection | null; refreshToken: number; mutationBusy: boolean;
  acquireMutation: () => number | null; releaseMutation: (token: number) => void;
  onSaved: () => void; onHighlights: (highlights: ReaderHighlight[]) => void; onJumpToPage: (page: number) => void;
}) {
  const { locale } = useI18n();
  const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const [collection, setCollection] = useState<NoteBlockCollection | null>(null);
  const [editor, setEditor] = useState<MemoEditor | null>(null);
  const editorRef = useRef<MemoEditor | null>(null);
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const [measuredHeight, setMeasuredHeight] = useState(420);
  const panelRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; position: MemoPosition } | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const writable = getWorkspaceMode() !== "local" && getWorkspaceRole() !== "viewer";
  const memo = editor ? decodeFloatingMemo(editor.draft.text) : null;
  const memos = collection?.items.filter((block) => decodeFloatingMemo(block.text)) ?? [];
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const updateEditor = useCallback((next: MemoEditor | null) => {
    editorRef.current = next; setEditor(next);
    if (next && !persistRevisionDraft(storage(), draftKey(paperId, next.blockId), next)) {
      setMessage(locale === "ko" ? "이 브라우저에 임시 메모를 보관하지 못했습니다. 창을 닫기 전에 저장해주세요." : "This browser could not preserve the memo draft. Save before leaving.");
    }
  }, [paperId, locale]);

  useEffect(() => {
    let active = true;
    apiClient.getNoteBlocks(paperId).then((value) => {
      if (!active) return;
      setCollection(value); onHighlights(citedBlockHighlights(value.items, paperId));
      const current = editorRef.current;
      if (current && !current.activeSave) {
        const remote = current.blockId ? value.items.find((block) => block.id === current.blockId) : null;
        if (remote || !current.blockId) updateEditor(receiveRemoteRevision(current, { value: remote ? editable(remote) : current.baseline, revision: value.note_blocks_revision }));
      } else if (!current) {
        const record = readPersistentRevisionDraft(storage(), draftKey(paperId));
        if (record) {
          const baseline = floatingMemoDraft();
          const restored = { ...createRevisionDraftState({ draft: baseline, revision: value.note_blocks_revision, record }), blockId: "" };
          if (decodeFloatingMemo(restored.draft.text)) { updateEditor(restored); setOpen(true); }
        }
      }
    }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Notes could not be loaded."); });
    return () => { active = false; };
  }, [paperId, refreshToken, onHighlights, updateEditor]);

  useEffect(() => {
    const update = () => setViewport({ width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight });
    update(); window.addEventListener("resize", update); window.visualViewport?.addEventListener("resize", update);
    return () => { window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, []);
  useEffect(() => { if (open) titleRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const observer = new ResizeObserver(([entry]) => setMeasuredHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [open]);

  function close() { setOpen(false); setListOpen(false); triggerRef.current?.focus(); }
  function openMemo(block: NoteBlock | null = null) {
    if (!collection || busyRef.current) return;
    if (!block && editorRef.current && !editorRef.current.blockId) { setOpen(true); setListOpen(false); return; }
    const baseline = block ? editable(block) : floatingMemoDraft(selection);
    const key = draftKey(paperId, block?.id);
    const record = readPersistentRevisionDraft(storage(), key);
    updateEditor({ ...createRevisionDraftState({ draft: baseline, revision: collection.note_blocks_revision, record }), blockId: block?.id ?? "" });
    setOpen(true); setListOpen(false); setMessage("");
  }
  function edit(fields: Partial<EditableNoteBlockContent>) {
    if (!writable) return;
    const current = editorRef.current;
    if (current) updateEditor(editRevisionDraft(current, { ...current.draft, ...fields }));
  }
  function move(position: MemoPosition) {
    const current = editorRef.current;
    const content = current ? decodeFloatingMemo(current.draft.text) : null;
    if (content) edit({ text: encodeFloatingMemo(content.text, position) });
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!memo || event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, position: memo.position };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (active?.id !== event.pointerId) return;
    move(clampMemoPosition({ x: active.position.x + (event.clientX - active.x) / viewport.width, y: active.position.y + (event.clientY - active.y) / viewport.height }));
  }
  function keyboardMove(event: KeyboardEvent<HTMLButtonElement>) {
    if (!memo || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    move(clampMemoPosition({ x: memo.position.x + (event.key === "ArrowLeft" ? -0.03 : event.key === "ArrowRight" ? 0.03 : 0), y: memo.position.y + (event.key === "ArrowUp" ? -0.03 : event.key === "ArrowDown" ? 0.03 : 0) }));
  }

  async function save() {
    const current = editorRef.current;
    if (!current || busyRef.current || mutationBusy || !writable || !decodeFloatingMemo(current.draft.text)?.text.trim()) return;
    if ((current.draft.provenance?.rectangles.length ?? 0) > 200) { setMessage(tr("한 번에 더 짧은 구간을 선택해주세요.", "Select a shorter excerpt before saving.")); return; }
    const started = beginRevisionSave(current);
    if (!started.request) return;
    const token = acquireMutation();
    if (token === null) return;
    busyRef.current = true; updateEditor(started.state); setMessage("");
    const request = started.request;
    try {
      const response = current.blockId
        ? await apiClient.updateNoteBlock(paperId, current.blockId, request.draft, request.revision)
        : await apiClient.createNoteBlock(paperId, request.draft, request.revision);
      if (!mounted.current) return;
      const active = editorRef.current;
      if (!active) return;
      const next = { ...completeRevisionSave(active, request.token, { value: editable(response.block), revision: response.note_blocks_revision }), blockId: response.block.id };
      updateEditor(next);
      if (!current.blockId) clearPersistentRevisionDraft(storage(), draftKey(paperId));
      setMessage(tr(next.saveState === "saved" ? "저장 완료 ✔️ · 이 논문의 메모 블록에 보관했습니다." : "저장 완료 · 저장 중 새로 입력한 내용은 아직 임시 메모입니다.", next.saveState === "saved" ? "Saved ✔️ · Kept in this paper’s note blocks." : "Saved · Newer edits remain in your local draft."));
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      const active = editorRef.current;
      if (!active) return;
      let failed = failRevisionSave(active, request.token, error instanceof ApiClientError ? error.kind : "error");
      if (error instanceof ApiClientError && error.kind === "conflict") {
        try {
          const latest = await apiClient.getNoteBlocks(paperId);
          if (!mounted.current) return;
          setCollection(latest);
          const block = latest.items.find((item) => item.id === current.blockId);
          if (block || !current.blockId) failed = receiveRemoteRevision(failed, { value: block ? editable(block) : current.baseline, revision: latest.note_blocks_revision, changedElsewhere: true });
        } catch { /* The exact local draft remains available for an explicit retry. */ }
      }
      updateEditor(failed); setMessage(tr("메모를 저장하지 못했습니다. 작성한 내용은 그대로 보관되어 있습니다.", "The memo was not saved. Your exact draft is preserved."));
    } finally { busyRef.current = false; releaseMutation(token); }
  }

  const panelWidth = Math.min(360, viewport.width - 24);
  const panelHeight = Math.min(measuredHeight, viewport.height - 24);
  const left = Math.max(12, Math.min(viewport.width - panelWidth - 12, (memo?.position.x ?? 0.65) * viewport.width));
  const top = Math.max(12, Math.min(viewport.height - panelHeight - 12, (memo?.position.y ?? 0.45) * viewport.height));
  return <div className="reader-floating-memos">
    <div className="reader-annotation-tools">
      <button ref={triggerRef} className="reader-control reader-control--secondary" type="button" disabled={!collection || !writable} onClick={() => openMemo()}><Plus size={15} />{tr(selection ? "선택 구간에 플로팅 메모" : "플로팅 메모", selection ? "Memo on selected text" : "Floating memo")}</button>
      <button className="reader-control reader-control--secondary" type="button" aria-expanded={listOpen} onClick={() => setListOpen((value) => !value)}><StickyNote size={15} />{tr(`저장한 메모 ${memos.length}개`, `Saved memos (${memos.length})`)}</button>
      {editor && !open ? <button className="text-link" type="button" onClick={() => setOpen(true)}>{tr("작성 중인 메모 열기", "Reopen current memo")}</button> : null}
    </div>
    {listOpen ? <div className="reader-memo-list" aria-label={tr("이 논문의 플로팅 메모", "Floating memos for this paper")}>
      {memos.length ? memos.map((block) => <button className="text-link" type="button" key={block.id} onClick={() => openMemo(block)}>{block.title || tr("제목 없는 메모", "Untitled memo")}{block.page ? ` · p. ${block.page}` : ""}</button>) : <p className="muted-text">{tr("아직 저장한 플로팅 메모가 없습니다.", "No floating memos saved yet.")}</p>}
    </div> : null}
    {message && !open ? <p role="status" className="reader-editor__status">{message}</p> : null}
    {open && editor && memo ? <aside ref={panelRef} className="reader-floating-memo" role="region" aria-label={tr("플로팅 연구 메모", "Floating research memo")} style={{ left, top, width: panelWidth }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <header className="reader-floating-memo__header"><button className="reader-memo-grip" type="button" aria-label={tr("메모 이동: 드래그하거나 방향키를 사용하세요", "Move memo: drag or use arrow keys")} title={tr("드래그 또는 방향키로 이동", "Drag or use arrow keys")} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={keyboardMove}><Grip size={16} />{tr("연구 메모", "Research memo")}</button><button type="button" className="reader-research-panel__collapse" aria-label={tr("메모 닫기: 임시 내용 유지", "Close memo and keep draft")} onClick={close}><X size={16} /></button></header>
      <div className="reader-floating-memo__body">
        <label className="reader-field"><span>{tr("메모 제목", "Memo title")}</span><input ref={titleRef} value={editor.draft.title} maxLength={200} disabled={!writable} onChange={(event) => edit({ title: event.target.value })} placeholder={tr("새로 알게 된 점", "What I learned")} /></label>
        {editor.draft.quote ? <details><summary>{tr(`연결한 원문 · ${editor.draft.page}쪽`, `Linked excerpt · p. ${editor.draft.page}`)}</summary><blockquote>{editor.draft.quote}</blockquote><button className="text-link" type="button" onClick={() => onJumpToPage(Number(editor.draft.page))}>{tr("원문 위치로 이동", "Go to excerpt")}</button></details> : null}
        <label className="reader-field"><span>{tr("내 해석과 지식", "My interpretation and knowledge")}</span><textarea rows={6} maxLength={95000} value={memo.text} disabled={!writable} onChange={(event) => edit({ text: encodeFloatingMemo(event.target.value, memo.position) })} placeholder={tr("핵심 개념, 의문, 내 연구와 연결할 점을 적어보세요.", "Record the key concept, a question, or a connection to your research.")} /></label>
        <div className="reader-editor__actions"><SaveStatus state={editor.saveState} /><button type="button" className="reader-control" disabled={!writable || mutationBusy || Boolean(editor.activeSave) || editor.saveState === "saved" || editor.saveState === "changed_elsewhere" || !memo.text.trim()} onClick={() => void save()}><Save size={15} />{tr("메모 저장", "Save memo")}</button></div>
        {editor.saveState === "changed_elsewhere" ? <><div className="reader-editor__actions"><button className="reader-control reader-control--secondary" type="button" disabled={editor.remoteRevision === editor.revision} onClick={() => updateEditor(keepMyRevisionDraft(editor))}>{tr("내 임시 메모 유지", "Keep my draft")}</button><button className="reader-control reader-control--secondary" type="button" onClick={() => { if (window.confirm(tr("임시 메모를 버리고 최근 저장본을 사용할까요?", "Discard this memo draft and use the latest saved version?"))) updateEditor(applyLatestRevisionDraft(editor)); }}>{tr("최근 저장본 사용", "Use latest saved version")}</button></div><details><summary>{tr("내 메모와 저장본 비교", "Compare draft and saved version")}</summary><pre>{memo.text}</pre><hr /><pre>{decodeFloatingMemo(editor.remote.text)?.text ?? editor.remote.text}</pre></details></> : null}
        <p className="muted-text">{tr("저장하면 이 논문의 메모 블록에서 다시 열고 프로젝트에 연결할 수 있습니다. 이동한 위치도 함께 저장합니다.", "Saved in this paper’s note blocks, where it can be linked to a project. Save also keeps this window position.")}</p>
        {message ? <p role="status">{message}</p> : null}
      </div>
    </aside> : null}
  </div>;
}
