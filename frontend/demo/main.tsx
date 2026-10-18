import { Component, Suspense, lazy, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../app/components/AppShell";
import { LoadingState } from "../app/components/AsyncStates";
import { getWorkspaceMode, initializeWorkspaceTransport, type WorkspaceSession } from "../app/lib/api/client";
import { LanguageToggle, LocaleProvider, useI18n } from "../app/lib/i18n/LocaleProvider";
import { PRODUCT_NAME } from "../app/lib/i18n/catalog";
import Link from "./link";
import { migrateLegacyRoute, usePathname } from "./navigation";
import "../app/globals.css";
import "./style.css";
import "../app/lib/continuity/continuity.css";
import { CloudStatus } from "../app/components/CloudStatus";
import { CollaborationInboxLink } from "../app/components/CollaborationInboxLink";
import { LabviumBrand } from "../app/components/LabviumBrand";

const CollaborationView = lazy(() => import("../app/views/CollaborationView").then(module => ({default:module.CollaborationView})));
const HomeView = lazy(() => import("../app/views/HomeView").then(module => ({default:module.HomeView})));
const AccountView = lazy(() => import("../app/views/AccountView").then(module => ({default:module.AccountView})));
const GuideView = lazy(() => import("../app/views/GuideView").then(module => ({default:module.GuideView})));
const ContinuityView = lazy(() => import("../app/views/ContinuityView").then(module => ({default:module.ContinuityView})));
const DashboardView = lazy(() => import("../app/views/DashboardView").then((module) => ({ default: module.DashboardView })));
const LibraryView = lazy(() => import("../app/views/LibraryView").then((module) => ({ default: module.LibraryView })));
const ProjectsView = lazy(() => import("../app/views/ProjectsView").then((module) => ({ default: module.ProjectsView })));
const TagsView = lazy(() => import("../app/views/TagsView").then((module) => ({ default: module.TagsView })));
const SettingsView = lazy(() => import("../app/views/SettingsView").then((module) => ({ default: module.SettingsView })));
const DiagnosticsView = lazy(() => import("../app/views/SettingsView").then((module) => ({ default: module.DiagnosticsView })));
const PaperDetailView = lazy(() => import("../app/views/PaperDetailView").then((module) => ({ default: module.PaperDetailView })));
const ReaderView = lazy(() => import("../app/views/ReaderView").then((module) => ({ default: module.ReaderView })));
const ProjectDetailView = lazy(() => import("../app/views/ProjectDetailView").then((module) => ({ default: module.ProjectDetailView })));
const ResearchWorkspaceView = lazy(() => import("../app/views/ResearchWorkspaceView").then((module) => ({ default: module.ResearchWorkspaceView })));
const DiscoverView = lazy(() => import("../app/views/DiscoverView").then((module) => ({ default: module.DiscoverView })));
const MaintenanceView = lazy(() => import("../app/views/MaintenanceView").then((module) => ({ default: module.MaintenanceView })));
const AssistantView = lazy(() => import("../app/views/AssistantView").then((module) => ({ default: module.AssistantView })));
const SearchView = lazy(() => import("../app/views/SearchView").then((module) => ({ default: module.SearchView })));
const TeamWorkspaceView = lazy(() => import("../app/views/TeamWorkspaceView").then((module) => ({ default: module.TeamWorkspaceView })));
const ProjectResearchView = lazy(() => import("../app/views/ProjectResearchView").then((module) => ({ default: module.ProjectResearchView })));
const ProjectReviewView = lazy(() => import("../app/views/ProjectReviewView").then((module) => ({ default: module.ProjectReviewView })));

function WorkspaceFailure() {
  const { t } = useI18n();
  return <section className="bandal-demo-error" role="alert"><h1>{t("Unable to open the workspace")}</h1><p>{t("Reload this page. Your saved edits will remain.")}</p><div className="bandal-demo-error__actions"><button className="reader-control" onClick={() => window.location.reload()}>{t("Reload page")}</button><Link className="reader-control reader-control--secondary" href="/dashboard">{t("Go to Dashboard")}</Link></div></section>;
}

class DemoErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("랩비움 view failed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <WorkspaceFailure />;
  }
}

function DemoBanner({ session }: { session: WorkspaceSession | null }) {
  const { locale } = useI18n(), ko = locale === "ko";
  const cloud = getWorkspaceMode() === "cloud" && !session?.connection_error;
  const banner = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = banner.current; if (!element) return;
    const update = () => document.documentElement.style.setProperty("--bandal-banner-height", `${element.offsetHeight}px`);
    update(); const observer = new ResizeObserver(update); observer.observe(element); return () => observer.disconnect();
  }, []);
  return <header ref={banner} className="bandal-demo-banner lv-topbar" aria-label={ko ? "계정과 저장 상태" : "Account and storage status"}>
    <p><Link href="/" className="bandal-demo-banner__brand"><LabviumBrand variant="compact" /></Link><span>{!session ? (ko ? "연결 확인 중" : "Connecting") : session.connection_error ? (ko ? "연결 확인 필요" : "Connection unavailable") : cloud ? <CloudStatus key={session.workspace_id} /> : (ko ? "브라우저 공간 · 이 기기에 저장" : "Browser workspace · saved on this device")}</span>{session?.role === "viewer" ? <span>{ko ? "읽기 전용" : "Read only"}</span> : null}</p>
    <nav aria-label={ko ? "계정 메뉴" : "Account menu"}><CollaborationInboxLink key={session?.workspace_id||"browser"}/><LanguageToggle/><Link href="/guide">{ko ? "사용 안내" : "Guide"}</Link><Link href="/account">{cloud && (session?.user?.name || session?.user?.email) ? session.user.name || session.user.email : ko ? "계정과 저장" : "Account and storage"}</Link>{session && !cloud ? <a href="/signin-with-chatgpt?return_to=%2FLabVium" target="_top">{ko ? "로그인" : "Sign in"}</a> : cloud ? <a href="/signout-with-chatgpt?return_to=%2FLabVium" target="_top">{ko ? "로그아웃" : "Sign out"}</a> : null}<details className="bandal-demo-about"><summary>{ko ? "서비스 정보" : "About"}</summary><div className="bandal-demo-about__content"><p>{ko ? "논문 탐색에서 결정과 인수인계까지 이어지는 연구 작업공간입니다." : "A research workspace connecting papers, decisions and handoff."}</p><p><a href="https://github.com/Lilshawn-LSY/BluePrintReboot" target="_blank" rel="noopener noreferrer">{ko ? "이서연(Lilshawn-LSY)·박상현 공동 프로젝트 BluePrintReboot 기반" : "Based on BluePrintReboot by Seoyeon Lee and Sanghyeon Park"}</a></p><p><a href="https://github.com/delimune04/blueprintreboot-bandal" target="_blank" rel="noopener noreferrer">{ko ? "LabVium 개발 소스" : "LabVium source"}</a> · <a href="https://bandal.app">BANDAL STUDIO</a></p><p><a href="mailto:support@bandal.app">support@bandal.app</a></p></div></details></nav>
  </header>;
}

function RouteView({ pathname }: { pathname: string }) {
  const { t } = useI18n();
  if (pathname === "/") return <HomeView />;
  if (pathname === "/dashboard") return <DashboardView />;
  if (pathname === "/account") return <AccountView />;
  if (pathname === "/guide") return <GuideView />;
  const ideaThread = /^\/collaboration\/ideas\/([^/]+)\/?$/.exec(pathname);
  if (ideaThread) return <CollaborationView initialTab="ideas" ideaId={decodeURIComponent(ideaThread[1])}/>;
  const taskThread = /^\/collaboration\/tasks\/([^/]+)\/?$/.exec(pathname);
  if (taskThread) return <CollaborationView initialTab="tasks" taskId={decodeURIComponent(taskThread[1])}/>;
  if (pathname === "/collaboration" || pathname === "/collaboration/calendar") return <CollaborationView initialTab="calendar"/>;
  if (pathname === "/collaboration/ideas") return <CollaborationView initialTab="ideas"/>;
  if (pathname === "/collaboration/tasks") return <CollaborationView initialTab="tasks"/>;
  if (pathname === "/collaboration/inbox") return <CollaborationView initialTab="inbox"/>;
  const continuity = /^\/projects\/([^/]+)\/continuity\/?$/.exec(pathname);
  if (continuity) return <ContinuityView projectId={decodeURIComponent(continuity[1])} />;
  if (pathname === "/library" || pathname === "/papers") return <LibraryView />;
  if (pathname === "/projects") return <ProjectsView />;
  if (pathname === "/tags") return <TagsView />;
  if (pathname === "/settings") return <SettingsView />;
  if (pathname === "/settings/diagnostics") return <DiagnosticsView />;
  if (pathname === "/workspace") return <ResearchWorkspaceView />;
  if (pathname === "/discover") return <DiscoverView />;
  if (pathname === "/maintenance") return <MaintenanceView />;
  if (pathname === "/assistant") return <AssistantView />;
  if (pathname === "/search") return <SearchView />;
  if (pathname === "/team") return <TeamWorkspaceView />;
  const projectResearch = /^\/projects\/([^/]+)\/research\/?$/.exec(pathname);
  if (projectResearch) return <ProjectResearchView projectId={decodeURIComponent(projectResearch[1])} />;
  const projectReview = /^\/projects\/([^/]+)\/review\/?$/.exec(pathname);
  if (projectReview) return <ProjectReviewView projectId={decodeURIComponent(projectReview[1])} />;
  const reader = /^\/papers\/([^/]+)\/reader\/?$/.exec(pathname);
  if (reader) return <ReaderView paperId={decodeURIComponent(reader[1])} />;
  const paper = /^\/papers\/([^/]+)\/?$/.exec(pathname);
  if (paper) return <PaperDetailView paperId={decodeURIComponent(paper[1])} />;
  const project = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  if (project) return <ProjectDetailView projectId={decodeURIComponent(project[1])} />;
  return (
    <section className="bandal-demo-error">
      <h1>{t("Page not found")}</h1>
      <p>{t("Choose a workspace page from the navigation.")}</p>
      <Link className="reader-control" href="/dashboard">{t("Go to Dashboard")}</Link>
    </section>
  );
}

function DemoApp() {
  const { locale, t } = useI18n();
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    let active = true;
    void initializeWorkspaceTransport().then((value) => { if (active) setSession(value); }).catch(() => { if (active) setSession({ authenticated: false, storage: "browser", connection_error: true }); });
    const changed = (event: Event) => { if (active) setSession((event as CustomEvent<WorkspaceSession>).detail); };
    window.addEventListener("labvium:workspace-mode", changed);
    return () => { active = false; window.removeEventListener("labvium:workspace-mode", changed); };
  }, []);
  useEffect(() => {
    const section = pathname.split("/").filter(Boolean)[0] || "dashboard";
    const sections: Record<string, string> = { dashboard: "Dashboard", collaboration: "Lab collaboration", library: "Library", papers: "Paper", projects: "Projects", tags: "Tags", settings: "Settings", workspace: "Research notes", discover: "Discover", maintenance: "Maintenance", assistant: "Research assistant", search: "Search research" };
    document.title = `${t(sections[section] || "Research workspace")} · ${PRODUCT_NAME}`;
  }, [pathname, locale, t]);
  useEffect(() => {
    // The original shell's skip link is a document anchor. Keep the SPA's hash
    // route intact while moving keyboard focus to the same original target.
    const skipToMain = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href='#main-content']") : null;
      if (!anchor) return;
      event.preventDefault();
      const main = document.getElementById("main-content");
      main?.setAttribute("tabindex", "-1");
      main?.focus();
    };
    document.addEventListener("click", skipToMain);
    return () => document.removeEventListener("click", skipToMain);
  }, []);
  return (
    <>
      <DemoBanner session={session} />
      {session?.connection_error ? <section className="bandal-demo-error" role="alert"><h1>{locale === "ko" ? "저장 공간에 연결하지 못했습니다" : "Could not connect to your workspace"}</h1><p>{locale === "ko" ? "계정 자료를 불러올 수 없어 편집을 잠시 멈췄습니다. 연결을 확인한 뒤 다시 열어주세요." : "Editing is paused because account storage could not be checked. Reconnect and reload."}</p><button className="reader-control" onClick={() => window.location.reload()}>{locale === "ko" ? "다시 연결" : "Reconnect"}</button></section> : session ? <AppShell>
        <DemoErrorBoundary key={pathname}>
          <Suspense fallback={<LoadingState label={t("Loading workspace data")} />}>
            <RouteView pathname={pathname} />
          </Suspense>
        </DemoErrorBoundary>
      </AppShell> : <div className="main-content"><LoadingState label={t("Connecting to your workspace…")} /></div>}
    </>
  );
}

migrateLegacyRoute();

const root = document.getElementById("root");
if (!root) throw new Error("The demo root element is missing.");
createRoot(root).render(<LocaleProvider><DemoApp /></LocaleProvider>);
