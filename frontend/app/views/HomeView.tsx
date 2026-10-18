"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Compass, FolderKanban, GitBranch, Layers, ListChecks, MessageCircle, NotebookPen, ShieldCheck, Users } from "lucide-react";
import { LabviumMotion } from "../components/LabviumMotion";
import { getWorkspaceMode } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";

const features = [
  { n: "01", ko: "논문 공부와 연구 노트", en: "Reading and research notes", detail: "논문·원문 근거·내 생각을 연결해 연구 기록으로 남깁니다.", english: "Connect papers, original evidence and your own reasoning.", href: "/workspace", icon: NotebookPen },
  { n: "02", ko: "주제별 프로젝트", en: "Projects by research question", detail: "연구 주제별로 논문과 노트, 판단 기록을 모읍니다.", english: "Keep literature and decisions together under a research question.", href: "/projects", icon: FolderKanban },
  { n: "03", ko: "계속 이어지는 논문 탐색", en: "Follow the next paper", detail: "논문 하나에서 다음 논문으로, 추천 이유를 확인하며 탐색합니다.", english: "Move from one paper to the next with a reason for each recommendation.", href: "/discover", icon: Compass },
  { n: "04", ko: "연구 관련성과 저자 정보", en: "Relevance and author context", detail: "연구 관련성을 먼저 보고, h-index는 저자 참고 정보로 확인합니다.", english: "Research relevance comes first; author metrics provide context.", href: "/discover", icon: BookOpen },
  { n: "05", ko: "3D 논문 연관 지도", en: "3D literature map", detail: "논문 사이의 연결과 유사도를 회전·확대하며 살펴봅니다.", english: "Rotate and explore the connections and similarities between papers.", href: "/projects", icon: Layers },
  { n: "06", ko: "비AI 추천과 선택적 AI", en: "Discovery with optional AI", detail: "추천과 근거 검색을 기본으로 사용하고, AI 연결 상태를 확인합니다.", english: "Use discovery and evidence search, with AI connection status clearly shown.", href: "/assistant", icon: Compass },
  { n: "07", ko: "논문 조건 비교표", en: "Compare research conditions", detail: "실험 조건·단위·한계와 원문 위치를 함께 비교합니다.", english: "Compare conditions, units, limitations and original source locations.", href: "/projects", icon: Layers },
  { n: "08", ko: "결정과 실패의 기록", en: "Decisions and lessons", detail: "채택·기각 이유와 실패 조건, 다음에 바꿀 변수를 남깁니다.", english: "Record why you chose a method, what failed and what to change next.", href: "/projects", icon: NotebookPen },
  { n: "09", ko: "실행으로 이어지는 인수인계", en: "A handoff that starts work", detail: "첫 논문과 선정 이유, 필요한 파일, 첫 작업과 질문을 연결합니다.", english: "Connect the first reading, its rationale, required files and next actions.", href: "/projects", icon: Users },
  { n: "10", ko: "재현 기록", en: "Trace a reproduction", detail: "논문 근거를 데이터 버전·Git 커밋·실험 결과에 연결합니다.", english: "Link evidence to dataset versions, Git commits and experiment results.", href: "/projects", icon: GitBranch },
  { n: "11", ko: "근거 변경과 재검토", en: "Review evidence changes", detail: "정정·철회·반대 결과를 기록하고 영향을 받는 판단을 찾습니다.", english: "Record corrections, retractions or conflicting findings and locate affected decisions.", href: "/projects", icon: ShieldCheck },
  { n: "12", ko: "권한과 연구 자산 보존", en: "Access and continuity", detail: "개인·팀 권한, 소유권 이전, 백업·내보내기를 관리합니다.", english: "Manage personal and team access, ownership, backups and exports.", href: "/team", icon: Users },
];

const workflow = [
  { n: "01", ko: "발견", en: "Discover", title: "다음 논문을 찾고", english: "Find the next paper", href: "/discover", icon: Compass },
  { n: "02", ko: "의견", en: "Discuss", title: "아이디어를 함께 검토하고", english: "Discuss an idea together", href: "/collaboration/ideas", icon: MessageCircle },
  { n: "03", ko: "담당", en: "Assign", title: "진행할 사람을 정하고", english: "Give the work an owner", href: "/collaboration/tasks", icon: ListChecks },
  { n: "04", ko: "기한", en: "Schedule", title: "다음 일정을 맞춥니다", english: "Set the next date", href: "/collaboration/calendar", icon: CalendarDays },
];

const collaboration = [
  { n: "01", ko: "같은 일정을 보고", en: "One shared schedule", detail: "실험·미팅·마감 일정을 한 캘린더에서 확인하고 함께 편집합니다.", english: "View and edit experiments, meetings and deadlines in a shared calendar.", action: "공유 캘린더 열기", englishAction: "Open shared calendar", href: "/collaboration/calendar", icon: CalendarDays },
  { n: "02", ko: "바로 의견을 묻고", en: "Ask for a second view", detail: "발견한 논문과 아이디어를 공유하고, 교수·동료와 댓글로 의견을 주고받습니다.", english: "Share a paper or idea and exchange comments with supervisors and colleagues.", action: "아이디어 검토 열기", englishAction: "Open idea reviews", href: "/collaboration/ideas", icon: MessageCircle },
  { n: "03", ko: "담당과 기한을 분명하게", en: "A clear owner and deadline", detail: "교수·사수가 팀원에게 일을 배정하고, 담당자는 진행 상황과 결과를 남깁니다.", english: "Supervisors assign work; each assignee records progress and the result.", action: "담당 업무 열기", englishAction: "Open assigned tasks", href: "/collaboration/tasks", icon: ListChecks },
];

export function HomeView() {
  const { locale } = useI18n();
  const ko = locale === "ko", cloud = getWorkspaceMode() === "cloud";
  return <div className="lv-home lv-home--connected">
    <LabviumMotion refreshKey={locale} />
    <section className="lv-hero lv-hero--connected" aria-labelledby="lv-home-title">
      <div className="lv-hero-intro" data-lv-reveal>
        <p className="lv-kicker"><span aria-hidden="true" />LabVium · {ko ? "연구가 이어지는 작업공간" : "Research, carried forward"}</p>
        <h1 id="lv-home-title">{ko ? <>읽은 논문에서,<br />함께하는 연구까지.</> : <>From reading papers.<br />To working together.</>}</h1>
        <p className="lv-hero-copy">{ko ? "좋은 논문을 찾고, 아이디어에 의견을 더하고, 다음 할 일을 정하세요. 공부와 협업의 기록이 하나의 연구 흐름으로 이어집니다." : "Find a useful paper, discuss the idea, and decide what to do next. Keep your reading and your team's work in one research flow."}</p>
        <div className="lv-actions">
          {cloud ? <Link className="reader-control" href="/projects">{ko ? "내 연구 이어가기" : "Open my research"}<ArrowRight size={16} /></Link> : <a className="reader-control" href="/signin-with-chatgpt?return_to=%2Fku-ai%2F" target="_top">{ko ? "계정으로 시작하기" : "Sign in to start"}<ArrowRight size={16} /></a>}
          <Link className="reader-control reader-control--secondary" href="/collaboration/calendar">{ko ? "연구실 일정 보기" : "View lab calendar"}<CalendarDays size={16} /></Link>
        </div>
        <p className="lv-hero-note">{ko ? cloud ? "개인 공부는 내 공간에, 함께하는 연구는 팀 공간에 보관하세요." : "브라우저 공간에서 먼저 둘러볼 수 있습니다. 팀과 함께 쓰려면 로그인하세요." : cloud ? "Keep personal study in your workspace, and shared research in a team workspace." : "Explore in a browser workspace first. Sign in to work with your team."}</p>
      </div>
      <nav className="lv-workflow" aria-label={ko ? "발견에서 기한까지 연구의 다음 단계" : "Your next research step"} data-lv-reveal data-lv-order="1">
        <div className="lv-workflow-heading"><span>{ko ? "연구의 다음 단계" : "The next step"}</span><GitBranch size={17} aria-hidden="true" /></div>
        <ol>{workflow.map(({ n, ko: label, en, title, english, href, icon: Icon }) => <li key={n}>
          <Link href={href}><span className="lv-workflow-number">{n}</span><Icon size={20} aria-hidden="true" /><span className="lv-workflow-text"><strong>{ko ? label : en}</strong><span>{ko ? title : english}</span></span><ArrowUpRight size={16} aria-hidden="true" /></Link>
        </li>)}</ol>
        <p>{ko ? "발견 → 의견 → 담당 → 기한" : "Discover → Discuss → Assign → Schedule"}</p>
      </nav>
    </section>

    <section className="lv-collaboration-intro" aria-labelledby="lv-collaboration-title">
      <div className="lv-section-heading" data-lv-reveal><div><p className="lv-section-label">{ko ? "연구실 협업" : "Work together"}</p><h2 id="lv-collaboration-title">{ko ? "좋은 생각이 다음 행동으로 이어지도록." : "Turn a good idea into the next action."}</h2></div><Link href="/team" className="text-link">{ko ? "팀 공간 선택" : "Choose a team"}<ArrowRight size={14} /></Link></div>
      <div className="lv-collaboration-links">{collaboration.map(({ n, ko: title, en, detail, english, action, englishAction, href, icon: Icon }, index) => <Link className="lv-collaboration-link" key={n} href={href} data-lv-reveal data-lv-order={index}>
        <div className="lv-collaboration-link-top"><Icon size={23} aria-hidden="true" /><span>{n}</span></div><h3>{ko ? title : en}</h3><p>{ko ? detail : english}</p><span className="lv-collaboration-action">{ko ? action : englishAction}<ArrowRight size={16} aria-hidden="true" /></span>
      </Link>)}</div>
    </section>

    <section className="lv-feature-section" aria-labelledby="lv-research-tools-title">
      <div className="lv-section-heading" data-lv-reveal><div><p className="lv-section-label">{ko ? "탐색부터 인수인계까지" : "From discovery to handoff"}</p><h2 id="lv-research-tools-title">{ko ? "쌓아 둔 공부가 연구의 근거가 됩니다." : "Make your reading part of the evidence."}</h2></div><Link href="/guide" className="text-link">{ko ? "사용 안내" : "User guide"}<ArrowRight size={14} /></Link></div>
      <div className="lv-feature-list">{features.map(({ n, ko: title, en, detail, english, href, icon: Icon }, index) => <Link href={href} key={n} className="lv-feature" data-lv-reveal data-lv-order={index % 2}><span className="lv-feature-no">{n}</span><Icon size={20} aria-hidden="true" /><div><h3>{ko ? title : en}</h3><p>{ko ? detail : english}</p></div><ArrowRight size={16} aria-hidden="true" /></Link>)}</div>
    </section>

    <section className="lv-home-end" aria-labelledby="lv-continuity-title" data-lv-reveal>
      <div className="lv-home-end-symbol" aria-hidden="true"><Users size={28} /></div><div><p className="lv-section-label">{ko ? "사람과 기록을 잇는 공간" : "People, knowledge, continuity"}</p><h2 id="lv-continuity-title">{ko ? "연구는 사람이 바뀌어도 이어져야 합니다." : "Research should continue when people change."}</h2><p>{ko ? "무엇을 읽었는지, 왜 선택했는지, 다음에 무엇을 해야 하는지. 후임이 다시 묻지 않아도 시작할 수 있도록 기록하세요." : "Keep what you read, why you chose it, and what needs to happen next, so the next researcher has a clear place to start."}</p><Link href="/team" className="text-link">{ko ? "개인·팀 공간 관리" : "Manage workspaces"}<ArrowRight size={14} /></Link></div>
    </section>
    <aside className="lv-home-storage-note" aria-label={ko ? "저장과 공유 안내" : "Storage and sharing"}><ShieldCheck size={18} aria-hidden="true" /><p>{ko ? cloud ? "같은 계정으로 로그인하면 다른 기기에서도 저장한 내용을 볼 수 있습니다. 팀 공간의 자료는 해당 팀에 초대된 구성원과 공유됩니다." : "현재 브라우저 공간의 내용은 이 기기에만 저장됩니다. 다른 기기에서 이어 보거나 교수·동료와 공유하려면 계정으로 로그인한 뒤 팀 공간을 선택하세요." : cloud ? "Sign in with the same account to access saved work on another device. Team content is shared with invited team members." : "Browser workspace content stays on this device. Sign in and choose a team workspace to continue on another device or share with colleagues."}</p></aside>
  </div>;
}
