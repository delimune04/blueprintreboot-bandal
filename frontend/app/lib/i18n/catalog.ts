import { WORKSPACE_KO } from "./workspace-catalog";
import { READER_KO } from "./reader-catalog";
import { ADVANCED_KO } from "./advanced-catalog";

export type Locale = "ko" | "en";
export type TranslationValues = Record<string, string | number>;
export const PRODUCT_NAME = "랩비움";

const REVIEW_KO: Record<string, string> = {
  "LabVium home":"서비스 홈", "Account and storage":"계정과 저장", "User guide":"사용 안내",
  "Decision and handoff review": "의사결정·인수인계 검토",
  "Current hypothesis": "현재 가설", "Key decisions": "주요 결정", "Failed attempts": "실패한 시도", "Next actions": "다음 행동",
  "Record why the project changed direction. Review the original evidence yourself; a linked source does not prove a claim.": "프로젝트의 방향을 바꾼 이유를 기록하세요. 출처 연결만으로 주장이 입증되지는 않으므로 원문 근거를 직접 확인하세요.",
  "Refresh sources": "근거 상태 새로고침", "Discard the unsaved changes to this review?": "저장하지 않은 검토 내용을 버릴까요?",
  "Review and source status refreshed.": "검토 내용과 근거 상태를 다시 불러왔습니다.",
  "Review draft saved. No snapshot was frozen.": "검토 초안을 저장했습니다. 확정 스냅샷은 아직 만들지 않았습니다.",
  "Freeze this saved review as a versioned snapshot? Open records remain unreviewed. Source links record traceability, not proof.": "저장한 검토 내용을 버전 스냅샷으로 확정할까요? 미검토 기록은 그대로 표시됩니다. 출처는 근거를 찾는 경로이며 입증 여부는 사람이 판단해야 합니다.",
  "Human-reviewed snapshot frozen. Future edits will not replace this version.": "사람이 검토한 스냅샷을 확정했습니다. 이후 편집해도 이 버전은 보존됩니다.",
  "Restore this project before editing its review.": "보관한 프로젝트를 복원하면 검토 내용을 편집할 수 있습니다.",
  "Evidence coverage": "검토 주장별 근거 연결률",
  "Coverage counts reviewed hypotheses, decisions and failed attempts with a source in this project. It does not measure correctness.": "검토 완료한 가설·결정·실패 기록 중 이 프로젝트의 출처가 연결된 비율입니다. 주장의 정확도를 뜻하지 않습니다.",
  "No reviewed claims yet": "검토 완료한 주장이 없습니다", "{count} open records": "미검토 기록 {count}개", "{count} questions or actions without sources": "출처 없는 질문·다음 행동 {count}개",
  "Reviewed substantive claims without evidence cannot be frozen. Add a project source or return the record to open review.": "근거 없는 가설·결정·실패 기록은 검토 완료 상태로 확정할 수 없습니다. 프로젝트 출처를 연결하거나 미검토로 되돌리세요.",
  "Some references are missing or no longer belong to this project. Restore the source relationship or remove the reference.": "없어졌거나 이 프로젝트의 범위를 벗어난 출처가 있습니다. 자료 연결을 복원하거나 해당 참조를 제거하세요.",
  "Evidence changed since this draft was saved. Review the current source, then save again before freezing.": "초안을 저장한 뒤 근거가 바뀌었습니다. 현재 원문을 확인하고 다시 저장한 다음 확정하세요.",
  "Linked evidence changed after the latest snapshot. Its saved input remains available, but it no longer describes the current source version.": "최근 스냅샷을 만든 뒤 연결 근거가 바뀌었습니다. 당시 입력은 보존되지만 현재 근거 버전과는 다릅니다.",
  "Only linked project papers, linked note blocks and research pages assigned to this project are offered as evidence. Extract PDF text in Reader to select a specific page.": "프로젝트에 연결한 논문·근거 노트와 이 프로젝트로 지정한 연구 페이지만 선택할 수 있습니다. 특정 페이지를 연결하려면 논문 읽기에서 PDF 본문을 추출하세요.",
  "Working review records": "작성 중인 검토 기록",
  "Changes remain a draft until Save review. AI provenance marks pasted AI text; this editor does not generate or verify it.": "‘검토 저장’을 누르기 전까지 변경 내용은 초안입니다. AI 표시는 붙여 넣은 AI 문장의 출처 구분이며 이 편집기에서 생성하거나 검증하지 않습니다.",
  "Record kind": "기록 종류", "Review status": "검토 상태", "Open · not reviewed": "미검토", "Reviewed by a person": "사람이 검토 완료", "Remove review record": "검토 기록 제거", "Research record": "연구 기록",
  "Owner": "담당자", "Due date": "예정일",
  "AI-origin wording remains labeled even after human review. Compare every claim with the original evidence.": "사람이 검토한 뒤에도 AI에서 온 문장이라는 표시는 유지됩니다. 각 주장을 원문 근거와 대조하세요.",
  "Inspect source excerpt": "근거 발췌 확인", "Missing or outside project": "출처 없음 또는 프로젝트 범위 밖", "Remove reference": "출처 연결 제거", "Add project evidence": "프로젝트 근거 추가", "Select a linked source location": "연결할 근거 위치 선택",
  "No source linked. This is a question or proposed action, not an established fact.": "연결한 출처가 없습니다. 확인된 사실이 아닌 질문 또는 다음 행동 제안입니다.",
  "No source linked. Keep this claim open until its evidence is recorded.": "연결한 출처가 없습니다. 근거를 기록하기 전까지 미검토 상태로 두세요.",
  "Add review record": "검토 기록 추가", "Save review": "검토 저장", "Human review checklist": "담당자 검토 목록",
  "Confirm that each section was considered, including sections where nothing has been recorded. This records your judgment, not external certification.": "기록이 없는 항목도 포함하여 다섯 영역을 모두 검토했는지 확인하세요. 담당자의 판단을 기록하며 외부 인증을 뜻하지 않습니다.",
  "Compared with the latest snapshot: {added} added, {changed} changed, {removed} removed.": "최근 스냅샷 대비 추가 {added}개 · 변경 {changed}개 · 제거 {removed}개",
  "Human reviewer name": "검토 담당자 이름", "Freeze reviewed snapshot": "검토 스냅샷 확정",
  "Save first. Each snapshot preserves the exact review input, selected source text and fingerprints, reviewer name and date. Open records remain marked unreviewed.": "먼저 검토 내용을 저장하세요. 각 스냅샷은 당시 입력·선택 근거 본문·지문값·검토자·날짜를 보존합니다. 미검토 기록은 그대로 표시됩니다.",
  "The 20-snapshot retention limit has been reached. Existing snapshots are preserved.": "스냅샷 보존 한도인 20개에 도달했습니다. 기존 스냅샷은 보존됩니다.",
  "Versioned handoff snapshots": "버전별 인수인계 스냅샷", "Select snapshot": "스냅샷 선택", "Export snapshot Markdown": "스냅샷 Markdown 내보내기",
  "Compared with the previous snapshot: {added} added, {changed} changed, {removed} removed.": "이전 스냅샷 대비 추가 {added}개 · 변경 {changed}개 · 제거 {removed}개",
  "The review checklist changed.": "검토 목록이 변경되었습니다.", "Added records": "추가한 기록", "Changed records": "변경한 기록", "Removed records": "제거한 기록",
  "Inspect frozen review and source inputs": "확정 당시 검토·근거 입력 확인", "This is the input saved at this snapshot, including the source version at that time.": "당시 근거 버전을 포함해 스냅샷을 확정할 때 저장한 입력입니다.",
  "No snapshot yet. Save the records, review the evidence and complete the checklist first.": "아직 스냅샷이 없습니다. 기록을 저장하고 근거와 검토 목록을 확인하세요.",
  "Loading project review": "프로젝트 검토를 불러오는 중",
};

const KO: Record<string, string> = {
  ...REVIEW_KO,
  ...ADVANCED_KO,
  ...READER_KO,
  ...WORKSPACE_KO,
  "Dashboard": "연구 홈", "Library": "논문 보관함", "Projects": "연구 프로젝트", "Tags": "태그", "Settings": "설정",
  "Reader": "논문 읽기", "Papers": "논문", "Paper": "논문", "Paper Detail": "논문 정보", "Project Detail": "프로젝트 정보",
  "Research workspace": "나의 연구 공간", "Research notes": "연구 노트", "Discover": "논문 찾기", "Research assistant": "연구 도우미", "Search research": "연구 자료 검색", "Maintenance": "자료 관리", "Diagnostics": "진단", "Breadcrumb": "현재 위치",
  "Primary navigation": "주요 메뉴", "Workspace settings": "작업 공간 설정", "Skip to content": "본문으로 건너뛰기",
  "Open navigation": "메뉴 열기", "Close navigation": "메뉴 닫기", "Pin navigation": "메뉴 고정", "Unpin navigation": "메뉴 고정 해제", "Pin": "고정", "Unpin": "고정 해제",
  "Expand sidebar": "메뉴 펼치기", "Collapse sidebar": "메뉴 접기", "Language": "화면 언어", "Choose interface language": "화면 언어 선택",
  "Saved": "저장됨", "Unsaved changes": "저장하지 않은 변경", "Saving...": "저장 중…", "Save failed": "저장 실패", "Changed elsewhere": "다른 곳에서 변경됨", "Offline": "연결 끊김",
  "unread": "읽기 전", "reading": "읽는 중", "read": "읽음", "finished": "읽기 완료", "active": "진행 중", "paused": "잠시 중단", "done": "완료", "archived": "보관됨",
  "low": "낮음", "normal": "보통", "high": "높음", "urgent": "긴급", "critical": "매우 중요", "Unread": "읽기 전", "Reading": "읽는 중", "Read": "읽음", "Finished": "읽기 완료",
  "Active": "진행 중", "Paused": "잠시 중단", "Done": "완료", "Archived": "보관됨", "Low": "낮음", "Normal": "보통", "High": "높음",
  "summary": "요약", "claim": "주장", "method": "방법", "evidence": "근거", "question": "질문", "idea": "아이디어", "limitation": "한계",
  "Related": "관련 자료", "Background": "배경 자료", "Key reference": "핵심 참고 자료", "Supports Project": "연구를 뒷받침함", "Raises question": "질문을 제기함", "Idea for Project": "연구 아이디어",
  "related": "관련 자료", "background": "배경 자료", "key_reference": "핵심 참고 자료", "supports_project": "연구를 뒷받침함", "raises_question": "질문을 제기함", "idea_for_project": "연구 아이디어",
  "healthy": "정상", "available": "사용 가능", "unavailable": "사용 불가", "warning": "확인 필요", "empty": "자료 없음", "corrupt": "손상됨", "clean": "변경 없음", "deprecated": "사용 중단",
  "Missing PDF": "PDF 없음", "Unavailable": "사용 불가", "Loading": "불러오는 중", "Ready": "준비됨", "Cached": "저장된 본문", "Stale": "갱신 필요", "Failed": "실패", "OCR needed": "문자 인식 필요", "Not extracted": "추출 전",
  "Retry": "다시 시도", "Search": "검색", "Search papers": "논문 검색", "Page tools": "화면 도구", "Loading workspace data": "작업 공간을 불러오는 중",
  "Reading from the local BluePrintReboot API.": "연구 자료를 불러오고 있습니다.", "Unable to load this view": "화면을 불러오지 못했습니다",
  "Local API unavailable": "연구 공간에 연결하지 못했습니다", "Start the local FastAPI service to connect this view. The application shell remains available offline.": "연결 상태를 확인한 뒤 다시 시도해주세요. 작업 중인 초안은 유지됩니다.",
  "The local BluePrintReboot API could not be reached.": "연구 자료에 연결하지 못했습니다. 연결 상태를 확인해주세요.",
  "An unexpected frontend error occurred.": "화면을 불러오는 중 문제가 생겼습니다. 다시 시도해주세요.",
  "The saved version changed. Reload the current version before retrying.": "저장된 내용이 바뀌었습니다. 최신 내용을 불러온 뒤 다시 시도해주세요.",
  "The submitted command data is invalid.": "입력한 내용을 확인해주세요.",
  "The local read model could not be read. Check the local data state and retry.": "연구 자료를 읽지 못했습니다. 자료 상태를 확인한 뒤 다시 시도해주세요.",
  "The local command could not be completed. Retry after checking the API.": "요청을 처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.",
  "The local API returned HTTP {status}.": "요청을 처리하지 못했습니다. 오류 코드: {status}",
  "Authors unknown": "저자 정보 없음", "Author unknown": "저자 정보 없음", "Untitled paper": "제목 없는 논문", "Not recorded": "미입력",
  "Loading workspace overview": "연구 현황을 불러오는 중", "Loading paper": "논문을 불러오는 중", "Loading selected paper": "선택한 논문을 불러오는 중", "Loading Settings summary": "자료 상태를 확인하는 중",
  "Loading tags": "태그를 불러오는 중", "Searching papers": "논문을 찾는 중", "Loading Projects": "프로젝트를 불러오는 중", "Loading structured Note Blocks": "근거 노트를 불러오는 중",
  "Note Blocks": "근거 노트", "Full Text": "논문 본문", "Paper Note": "읽기노트", "Note": "읽기노트", "Blocks": "근거 노트", "Details": "논문 정보",
  "Paper metadata": "논문 정보", "Save Paper Note": "읽기노트 저장", "Save Metadata": "논문 정보 저장", "Metadata updates": "논문 정보 보완", "Heading": "제목", "Paper Note and Note Blocks": "읽기노트와 근거 노트", "Notes and blocks": "노트와 근거",
  "Title": "제목", "Authors": "저자", "Author": "저자", "Year": "연도", "Journal": "학술지", "Abstract": "초록", "Keywords": "키워드", "Status": "상태", "Priority": "우선순위", "Name": "이름", "Description": "설명", "Description (optional)": "설명 (선택)",
  "Save": "저장", "Cancel": "취소", "Close": "닫기", "Add": "추가", "Edit": "수정", "Delete": "삭제", "Remove": "제거", "Previous": "이전", "Next": "다음", "None stored": "없음", "No tags yet": "아직 태그가 없습니다", "Read only": "읽기 전용",
  "Read paper": "논문 읽기",
  "Open Library": "논문 보관함 열기", "Open Reader": "논문 읽기", "View Paper Detail": "논문 정보 보기", "Open Diagnostics": "자료 상태 확인", "Review diagnostics": "자료 상태 확인",
  "Demo notice": "시연 안내", "Demo external links": "시연 관련 링크", "Bandal home": "반달 홈페이지", "My GitHub copy": "내 GitHub 사본",
  "KU-AI demo · Sample materials · Edits are saved in this browser": "KU-AI 시연 · 샘플 자료 · 변경 내용은 이 브라우저에 저장",
  "A personal demonstration of the joint project by Seoyeon Lee (Lilshawn-LSY) and Sanghyeon Park": "이서연(Lilshawn-LSY)·박상현 공동 프로젝트의 개인 시연판",
  "Papers and full text are demonstration samples. Note, tag, and project edits stay in this browser.": "논문과 본문은 시연용 샘플입니다. 노트·태그·프로젝트 변경 내용은 이 브라우저에만 저장됩니다.",
  "Local file management and external metadata updates require the local application.": "컴퓨터의 파일 관리와 외부 논문 정보 갱신은 로컬 앱에서 이용할 수 있습니다.",
  "Unable to open the workspace": "작업 공간을 열지 못했습니다", "Reload this page. Your edits saved in this browser will remain.": "페이지를 다시 열어주세요. 이 브라우저에 저장한 변경 내용은 유지됩니다.", "Reload page": "페이지 다시 열기", "Go to Dashboard": "연구 홈으로 이동", "Page not found": "페이지를 찾을 수 없습니다", "Choose a workspace page from the navigation.": "메뉴에서 작업 공간을 다시 선택해주세요.",
  "Reload this page. Your saved edits will remain.": "페이지를 다시 열어주세요. 저장된 변경 내용은 유지됩니다.", "Connecting to your workspace…": "연구 공간에 연결하는 중…", "Personal workspace · Saved to your account": "개인 연구 공간 · 계정에 저장", "Connection check failed · Browser workspace active": "계정 연결 확인 실패 · 브라우저 연구 공간 사용 중", "Browser workspace · Edits stay in this browser": "브라우저 연구 공간 · 변경 내용은 이 브라우저에 저장", "Sign in to save to your account": "로그인하고 계정에 저장", "About this workspace": "연구 공간 안내", "Your papers and research are saved in your personal account workspace.": "논문과 연구 자료는 개인 계정의 연구 공간에 저장됩니다.", "PDF uploads and research tools use your account workspace.": "PDF와 연구 자료를 개인 계정 공간에서 관리할 수 있습니다.",
  "Cloud workspace · Saved with workspace permissions": "계정 연구 공간 · 작업 공간 권한에 따라 저장", "Team workspaces": "공동 연구 공간", "Papers and research are saved in the selected private or shared workspace.": "논문과 연구 자료는 선택한 개인 또는 공동 연구 공간에 저장됩니다.", "You can upload your own PDFs and save notes in this browser. The initial papers are authored demonstration samples.": "내 PDF를 가져오고 이 브라우저에 노트를 저장할 수 있습니다. 처음 제공된 논문은 시연용으로 작성된 샘플입니다.", "PDF text extraction, evidence capture, scholarly discovery and verified backups are available. Generative AI requires a connected model API.": "PDF 본문 추출·근거 수집·논문 찾기·검증된 백업을 사용할 수 있습니다. 생성형 AI는 모델 연결이 필요합니다.",
};

// English overrides simplify older implementation-oriented labels without
// changing the stored command enums or original research content.
const EN: Record<string, string> = {
  "Reading from the local BluePrintReboot API.": "Loading your research materials.",
  "Start the local FastAPI service to connect this view. The application shell remains available offline.": "Check the connection and try again. Your working drafts are retained.",
  "Local API unavailable": "Workspace unavailable", "Note Blocks": "Evidence notes", "Blocks": "Evidence", "Details": "Paper details",
  "This web workspace does not currently offer editable settings. Your papers, notes, projects, and tags stay on this device.": "Choose your interface language and review how this workspace stores research.",
  "Only values returned by the safe summary API are shown; this page never generates sample counts or backup history.": "Only confirmed workspace and backup information is shown.",
  "Workspace information and maintenance tools for this local application.": "Manage your interface language and research materials.",
  "Review suggestions, browse the tag book, and manage one tag at a time.": "Organize tags and review suggestions for each paper.",
  "Tag registry": "Tag collection", "Canonical key:": "Tag identifier:", "Local API": "Workspace connection", "Metadata": "Paper information",
  "샘플 PDF는 웹 시연에서 삭제하지 않습니다.": "Bundled sample PDFs cannot be removed in the browser workspace.",
  "외부 메타데이터 조회는 로컬 앱에서 이용할 수 있습니다.": "External paper information is available in the local application.",
  "웹 시연에서는 제공된 샘플 PDF를 사용합니다. PDF 가져오기는 로컬 앱에서 이용할 수 있습니다.": "The browser demonstration uses bundled sample PDFs. PDF importing is available in the local application.",
};

function interpolate(value: string, values: TranslationValues) {
  return value.replace(/\{([\w]+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]));
}

function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function compileTemplates(catalog: Record<string, string>) {
  return Object.entries(catalog).filter(([template]) => template.includes("{")).map(([template, translated]) => {
    const keys: string[] = [];
    let previous = 0;
    let pattern = "^";
    for (const match of template.matchAll(/\{([\w]+)\}/g)) {
      pattern += escapePattern(template.slice(previous, match.index)) + "(.*?)";
      keys.push(match[1]);
      previous = (match.index || 0) + match[0].length;
    }
    pattern += escapePattern(template.slice(previous)) + "$";
    return { translated, keys, pattern: new RegExp(pattern) };
  });
}

const TEMPLATES = { ko: compileTemplates(KO), en: compileTemplates(EN) };

export function translate(source: string, locale: Locale = "ko", values: TranslationValues = {}): string {
  const catalog = locale === "ko" ? KO : EN;
  const direct = catalog[source];
  if (direct !== undefined) return interpolate(direct, values);
  const resolvedSource = interpolate(source, values);
  // System messages can be persisted as the original English string while
  // still responding to a language change. Only registered templates match.
  for (const { translated, keys, pattern } of TEMPLATES[locale]) {
    const match = pattern.exec(resolvedSource);
    if (match) return interpolate(translated, Object.fromEntries(keys.map((key, index) => [key, match[index + 1]])));
  }
  return interpolate(source, values);
}
