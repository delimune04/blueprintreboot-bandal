import { Component, Suspense, lazy, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../app/components/AppShell";
import { LoadingState } from "../app/components/AsyncStates";
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

class DemoErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("BluePrint demo view failed", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="bandal-demo-error" role="alert">
        <h1>작업 공간을 열지 못했습니다</h1>
        <p>페이지를 다시 열어주세요. 이 브라우저에 저장한 변경 내용은 유지됩니다.</p>
        <div className="bandal-demo-error__actions">
          <button className="reader-control" onClick={() => window.location.reload()}>페이지 다시 열기</button>
          <Link className="reader-control reader-control--secondary" href="/dashboard">Dashboard로 이동</Link>
        </div>
      </section>
    );
  }
}

function DemoBanner() {
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
    <header ref={banner} className="bandal-demo-banner" aria-label="시연 안내">
      <p><span className="bandal-demo-banner__brand">Bandal × BluePrint</span><span>KU-AI 시연 · 샘플 자료 · 변경 내용은 이 브라우저에 저장</span></p>
      <nav aria-label="시연 외부 링크">
        <a href="https://bandal.app">반달 홈페이지 <span aria-hidden="true">↗</span></a>
        <a href="https://github.com/delimune04/blueprintreboot-bandal" target="_blank" rel="noopener noreferrer">내 GitHub 사본 <span aria-hidden="true">↗</span></a>
        <details className="bandal-demo-about">
          <summary>시연 안내</summary>
          <div className="bandal-demo-about__content">
            <p><a href="https://github.com/Lilshawn-LSY/BluePrintReboot" target="_blank" rel="noopener noreferrer">이서연(Lilshawn-LSY)·박상현 공동 프로젝트의 개인 시연판</a></p>
            <p>논문과 본문은 시연용 샘플입니다. 메모·태그·프로젝트 변경 내용은 이 브라우저에만 저장됩니다.</p>
            <p>PDF 업로드·컴퓨터의 파일 가져오기·외부 메타데이터 조회·본문 추출은 원래의 로컬 앱에서 이용할 수 있습니다.</p>
          </div>
        </details>
      </nav>
    </header>
  );
}

function RouteView({ pathname }: { pathname: string }) {
  if (pathname === "/" || pathname === "/dashboard") return <DashboardView />;
  if (pathname === "/library" || pathname === "/papers") return <LibraryView />;
  if (pathname === "/projects") return <ProjectsView />;
  if (pathname === "/tags") return <TagsView />;
  if (pathname === "/settings") return <SettingsView />;
  if (pathname === "/settings/diagnostics") return <DiagnosticsView />;
  const reader = /^\/papers\/([^/]+)\/reader\/?$/.exec(pathname);
  if (reader) return <ReaderView paperId={decodeURIComponent(reader[1])} />;
  const paper = /^\/papers\/([^/]+)\/?$/.exec(pathname);
  if (paper) return <PaperDetailView paperId={decodeURIComponent(paper[1])} />;
  const project = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  if (project) return <ProjectDetailView projectId={decodeURIComponent(project[1])} />;
  return (
    <section className="bandal-demo-error">
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>탐색 메뉴에서 작업 공간을 다시 선택해주세요.</p>
      <Link className="reader-control" href="/dashboard">Dashboard로 이동</Link>
    </section>
  );
}

function DemoApp() {
  const pathname = usePathname();
  useEffect(() => {
    const section = pathname.split("/").filter(Boolean)[0] || "dashboard";
    document.title = `${section.charAt(0).toUpperCase()}${section.slice(1)} · BluePrint · KU-AI 시연`;
  }, [pathname]);
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
      <DemoBanner />
      <AppShell>
        <DemoErrorBoundary key={pathname}>
          <Suspense fallback={<LoadingState label="작업 공간을 여는 중" />}>
            <RouteView pathname={pathname} />
          </Suspense>
        </DemoErrorBoundary>
      </AppShell>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("The demo root element is missing.");
createRoot(root).render(<DemoApp />);
