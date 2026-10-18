"use client";

import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { downloadManagedPdf } from "../lib/workspace/pdf-access.mjs";

export function ReaderPdfDownload({ paperId, title }: { paperId: string; title: string }) {
  const { locale } = useI18n();
  const say = (ko: string, en: string) => locale === "ko" ? ko : en;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, [paperId]);

  async function download() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setNotice("");
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      await downloadManagedPdf(paperId, title, controller.signal);
      if (pending.current === controller && !controller.signal.aborted) setNotice(say("PDF 다운로드를 시작했습니다.", "The PDF download has started."));
    } catch {
      if (pending.current === controller) setNotice(controller.signal.aborted ? say("PDF를 가져오는 시간이 초과됐습니다. 다시 다운로드해 주세요.", "Fetching the PDF timed out. Try downloading again.") : say("PDF를 다운로드하지 못했습니다. 연결을 확인하고 다시 눌러주세요.", "The PDF could not be downloaded. Check the connection and try again."));
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <div className="reader-toolbar__group">
    <button className="reader-control reader-control--secondary" type="button" disabled={busy} aria-busy={busy} onClick={() => void download()}><Download size={16} aria-hidden="true" />{busy ? say("PDF 준비 중…", "Preparing PDF…") : say("PDF 다운로드", "Download PDF")}</button>
    {notice ? <span className="muted-text" role="status">{notice}</span> : null}
  </div>;
}
