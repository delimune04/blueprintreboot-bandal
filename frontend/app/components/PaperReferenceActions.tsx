"use client";

import { useRef, useState } from "react";
import type { PaperDetail } from "../lib/api/types";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { copyPaperReference, paperReference } from "../lib/workspace/paper-reference.mjs";

export function PaperReferenceActions({ paper }: { paper: PaperDetail }) {
  const { locale } = useI18n();
  const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const reference = paperReference(paper, locale);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  async function copy() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      const copied = await copyPaperReference(reference.text, navigator.clipboard);
      setNotice(copied ? tr("서지정보를 복사했습니다. 제출 전 원문과 인용 양식을 확인하세요.", "Reference copied. Check the original and your required citation style before submission.") : tr("자동 복사를 사용할 수 없습니다. 아래 선택된 내용을 직접 복사하세요.", "Automatic copy is unavailable. Copy the selected text below."));
      if (!copied) { preview.current?.focus(); preview.current?.select(); }
    } finally { lock.current = false; setBusy(false); }
  }
  return <div className="paper-reference-actions">
    <p className="muted-text">{tr("저장된 서지정보를 그대로 복사합니다. APA 등 제출용 인용 형식으로 자동 변환하지 않으며, 권·호·쪽수 등은 원문에서 확인하세요.", "Copy the stored metadata as plain text. This does not format an APA or submission-ready citation; check volume, issue and pages against the original.")}</p>
    {reference.missing.length ? <p role="note">{tr("미등록 항목", "Missing fields")}: {reference.missing.join(", ")}. {tr("원문에서 확인한 뒤 보완하세요.", "Check the original before completing these fields.")}</p> : null}
    <label style={{display: "block"}}>
      {tr("복사할 서지정보", "Reference preview")}
      <textarea ref={preview} readOnly value={reference.text} rows={Math.min(10, reference.text.split("\n").length + 1)} style={{display: "block", width: "100%", boxSizing: "border-box", resize: "vertical", marginTop: "0.5rem"}} />
    </label>
    <button type="button" className="reader-control reader-control--secondary" disabled={busy} onClick={() => void copy()}>{busy ? tr("복사 중…", "Copying…") : tr("서지정보 복사", "Copy reference")}</button>
    <p role="status" aria-live="polite">{notice}</p>
  </div>;
}
