import { Component, Suspense, lazy, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../app/components/AppShell";
import { LoadingState } from "../app/components/AsyncStates";
import { getWorkspaceMode, initializeWorkspaceTransport, type WorkspaceSession } from "../app/lib/api/client";
import { LanguageToggle, LocaleProvider, useI18n } from "../app/lib/i18n/LocaleProvider";
import { PRODUCT_NAME } from "../app/lib/i18n/catalog";
import Link from "./link";
import { usePathname } from "./navigation";
import "../app/globals.css";
import "./style.css";

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
  const { t } = useI18n();
  const cloud = getWorkspaceMode() === "cloud";
  const banner = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = banner.current;
    if (!element) return;
    const update = () => document.documentElement.style.setProperty("--bandal-banner-height", `${element.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <header ref={banner} className="bandal-demo-banner" aria-label={t("Demo notice")}>
      <p><span className="bandal-demo-banner__brand">Bandal × {PRODUCT_NAME}</span><span>{!session ? t("Connecting to your workspace…") : cloud ? t("Cloud workspace · Saved with workspace permissions") : session.connection_error ? t("Connection check failed · Browser workspace active") : t("Browser workspace · Edits stay in this browser")}{session?.role === "viewer" ? ` · ${t("Read only")}` : ""}{cloud && (session?.user?.name || session?.user?.email) ? <> · {session.user.name || session.user.email}</> : null}</span></p>
      <nav aria-label={t("Demo external links")}>
        <LanguageToggle />
        <Link href="/team">{t("Team workspaces")}</Link>
        {session && !cloud ? <a href="/signin-with-chatgpt?return_to=%2Fku-ai%2F" target="_top">{t("Sign in to save to your account")}</a> : null}
        <a href="https://bandal.app">{t("Bandal home")} <span aria-hidden="true">↗</span></a>
        <a href="https://github.com/delimune04/blueprintreboot-bandal" target="_blank" rel="noopener noreferrer">{t("My GitHub copy")} <span aria-hidden="true">↗</span></a>
        <details className="bandal-demo-about">
          <summary>{t("About this workspace")}</summary>
          <div className="bandal-demo-about__content">
            <p><a href="https://github.com/Lilshawn-LSY/BluePrintReboot" target="_blank" rel="noopener noreferrer">{t("A personal demonstration of the joint project by Seoyeon Lee (Lilshawn-LSY) and Sanghyeon Park")}</a></p>
            <p>{cloud ? t("Papers and research are saved in the selected private or shared workspace.") : t("You can upload your own PDFs and save notes in this browser. The initial papers are authored demonstration samples.")}</p>
            <p>{t("PDF text extraction, evidence capture, scholarly discovery and verified backups are available. Generative AI requires a connected model API.")}</p>
          </div>
        </details>
      </nav>
    </header>
  );
}

function RouteView({ pathname }: { pathname: string }) {
  const { t } = useI18n();
  if (pathname === "/" || pathname === "/dashboard") return <DashboardView />;
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
    const sections: Record<string, string> = { dashboard: "Dashboard", library: "Library", papers: "Paper", projects: "Projects", tags: "Tags", settings: "Settings", workspace: "Research notes", discover: "Discover", maintenance: "Maintenance", assistant: "Research assistant", search: "Search research" };
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
      {session ? <AppShell>
        <DemoErrorBoundary key={pathname}>
          <Suspense fallback={<LoadingState label={t("Loading workspace data")} />}>
            <RouteView pathname={pathname} />
          </Suspense>
        </DemoErrorBoundary>
      </AppShell> : <div className="main-content"><LoadingState label={t("Connecting to your workspace…")} /></div>}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("The demo root element is missing.");
createRoot(root).render(<LocaleProvider><DemoApp /></LocaleProvider>);
