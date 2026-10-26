"use client";
import { useState, type MouseEvent } from "react";
import type { ReviewRow, ReviewKind } from "../lib/review/model.mjs";
import { REVIEW_KINDS } from "../lib/review/model.mjs";
import { findReviewRecords } from "../lib/review/navigation.mjs";

export function ReviewRecordNavigator({ rows, ko }: { rows: ReviewRow[]; ko: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "reviewed">("all");
  const [kind, setKind] = useState<"all" | ReviewKind>("all");
  const kinds: Record<ReviewKind, string> = ko
    ? { hypothesis: "현재 가설", decision: "주요 결정", failed_attempt: "실패한 시도", question: "미해결 질문", next_action: "다음 행동" }
    : { hypothesis: "Current hypothesis", decision: "Key decisions", failed_attempt: "Failed attempts", question: "Open questions", next_action: "Next actions" };
  const matches = findReviewRecords(rows, query, status, kind);
  function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const record = document.getElementById(`review-${id}`);
    if (!record) return;
    const field = record.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)");
    (field || record).focus({ preventScroll: true });
    record.scrollIntoView({ block: "start", behavior: "instant" });
  }
  return <nav className="review-record-navigator" aria-label={ko ? "검토 기록 바로가기" : "Review record navigator"}>
    <h3>{ko ? "검토 기록 바로가기" : "Find a review record"}</h3>
    <p className="muted-text">{ko ? "내용·담당자·조건으로 찾거나 미검토 기록을 모아 보세요. 아래 원본 기록과 저장 범위는 바뀌지 않습니다." : "Find text, owners or conditions, or list unreviewed records. The full editor and saved records remain unchanged."}</p>
    <div className="review-actions">
      <label className="reader-field"><span>{ko ? "기록 검색" : "Search review records"}</span><input type="search" maxLength={300} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="reader-field"><span>{ko ? "바로가기 검토 상태" : "Navigator review status"}</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">{ko ? "모든 상태" : "All statuses"}</option><option value="open">{ko ? "미검토" : "Unreviewed"}</option><option value="reviewed">{ko ? "사람 검토 완료" : "Human reviewed"}</option></select></label>
      <label className="reader-field"><span>{ko ? "바로가기 기록 유형" : "Navigator record kind"}</span><select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="all">{ko ? "모든 유형" : "All kinds"}</option>{REVIEW_KINDS.map(value => <option key={value} value={value}>{kinds[value]}</option>)}</select></label>
      <button type="button" className="reader-control reader-control--secondary" disabled={!query && status === "all" && kind === "all"} onClick={() => { setQuery(""); setStatus("all"); setKind("all"); }}>{ko ? "검색 조건 지우기" : "Clear search filters"}</button>
    </div>
    <p role="status">{ko ? `전체 ${rows.length}개 중 ${matches.length}개 바로가기` : `${matches.length} of ${rows.length} record shortcuts`}</p>
    {matches.length ? <ol className="review-record-shortcuts">{matches.map(({row,number}) => <li key={row.id}><a href={`#review-${row.id}`} onClick={event => jump(event,row.id)}><span>{number}. {row.text.trim().slice(0,100) || (ko ? "내용 미작성" : "Untitled record")}{row.text.trim().length > 100 ? "…" : ""}</span><small>{kinds[row.kind]} · {row.status === "open" ? (ko ? "미검토" : "Unreviewed") : (ko ? "사람 검토 완료" : "Human reviewed")} · {row.owner || (ko ? "담당자 미지정" : "Owner not assigned")}</small></a></li>)}</ol> : <p>{rows.length ? (ko ? "일치하는 기록이 없습니다. 검색어·검토 상태·기록 유형 조건을 지워 보세요." : "No matching records. Clear the search, status or record-kind filter.") : (ko ? "검토 기록을 추가하면 여기서 바로 찾을 수 있습니다." : "Add review records to find them here.")}</p>}
  </nav>;
}
