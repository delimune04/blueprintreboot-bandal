"use client";

import { usePathname } from "next/navigation";
import { PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SidebarNavigation } from "./SidebarNavigation";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { PRODUCT_NAME } from "../lib/i18n/catalog";
import { useModalFocus } from "../hooks/useModalFocus";

const NORMAL_SIDEBAR_PREFERENCE_KEY = "blueprint.ui.normal-sidebar-collapsed";
const NORMAL_SIDEBAR_PREFERENCE_EVENT = "blueprint.ui.normal-sidebar-changed";

function getNormalSidebarPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(NORMAL_SIDEBAR_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribeToNormalSidebarPreference(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NORMAL_SIDEBAR_PREFERENCE_EVENT, onStoreChange);
  return () => window.removeEventListener(NORMAL_SIDEBAR_PREFERENCE_EVENT, onStoreChange);
}

const NARROW_NAVIGATION_QUERY = "(max-width: 64rem)";

function subscribeToNarrowNavigation(onStoreChange: () => void): () => void {
  const query = window.matchMedia(NARROW_NAVIGATION_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getNarrowNavigation(): boolean {
  return typeof window !== "undefined" && window.matchMedia(NARROW_NAVIGATION_QUERY).matches;
}

function isReaderRoute(pathname: string): boolean {
  return /^\/papers\/[^/]+\/reader\/?$/.test(pathname);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const readerRoute = isReaderRoute(pathname);
  const normalSidebarCollapsed = useSyncExternalStore(
    subscribeToNormalSidebarPreference,
    getNormalSidebarPreference,
    () => false,
  );
  const [readerSidebarOpen, setReaderSidebarOpen] = useState(false);
  const [readerSidebarPinned, setReaderSidebarPinned] = useState(false);
  const [mobileSidebarPath, setMobileSidebarPath] = useState<string | null>(null);
  const narrowNavigation = useSyncExternalStore(subscribeToNarrowNavigation, getNarrowNavigation, () => false);
  const mobileSidebarOpen = mobileSidebarPath === pathname;
  const sidebarOpen = readerRoute ? readerSidebarOpen : !narrowNavigation || mobileSidebarOpen;
  const navigationModalOpen = narrowNavigation && sidebarOpen;
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const closeNavigation = useCallback(() => {
    setMobileSidebarPath(null);
    setReaderSidebarOpen(false);
  }, []);
  const navigationRef = useModalFocus<HTMLElement>({
    active: navigationModalOpen,
    onRequestClose: closeNavigation,
    restoreFocusRef: navigationTriggerRef,
  });

  useEffect(() => {
    if (!navigationModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [navigationModalOpen]);
  useEffect(() => {
    if (!readerRoute || !readerSidebarOpen || narrowNavigation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeNavigation();
      navigationTriggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [readerRoute, readerSidebarOpen, narrowNavigation, closeNavigation]);
  useEffect(() => {
    const key = pathname.split("/").filter(Boolean)[0] || "dashboard";
    const pages: Record<string, string> = { dashboard: "Dashboard", collaboration: "Lab collaboration", library: "Library", papers: readerRoute ? "Reader" : "Paper", projects: "Projects", tags: "Tags", settings: "Settings", workspace: "Research notes", discover: "Discover", assistant: "Research assistant", search: "Search research", maintenance: "Maintenance" };
    document.title = `${t(pages[key] || "Research workspace")} · ${PRODUCT_NAME}`;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute("content", locale === "ko" ? "랩비움에서 논문을 읽고 근거 노트와 연구 프로젝트를 연결하세요." : "Read papers and connect evidence notes with research projects in 랩비움.");
  }, [pathname, readerRoute, locale, t]);

  const toggleNormalSidebar = () => {
    try {
      window.sessionStorage.setItem(NORMAL_SIDEBAR_PREFERENCE_KEY, String(!normalSidebarCollapsed));
      window.dispatchEvent(new Event(NORMAL_SIDEBAR_PREFERENCE_EVENT));
    } catch {
      // Navigation remains available when browser storage is restricted.
    }
  };

  return (
    <div
      className={readerRoute ? "app-shell app-shell--reader" : "app-shell"}
      data-sidebar-collapsed={!readerRoute && normalSidebarCollapsed}
      data-reader-sidebar-open={readerRoute && readerSidebarOpen}
      data-navigation-open={navigationModalOpen}
    >
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>{t("Skip to content")}</a>
      {!readerRoute ? <header className="workspace-appbar">
        <button
          ref={navigationTriggerRef}
          className="workspace-appbar__trigger"
          type="button"
          aria-label={t(mobileSidebarOpen ? "Close navigation" : "Open navigation")}
          aria-expanded={mobileSidebarOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileSidebarPath(mobileSidebarOpen ? null : pathname)}
        ><PanelLeftOpen aria-hidden="true" size={20} /></button>
        <span className="workspace-appbar__brand"><span className="brand__mark" aria-hidden="true" /><strong>{PRODUCT_NAME}</strong></span>
        <span className="workspace-appbar__context">{t("Research workspace")}</span>
      </header> : null}
      {navigationModalOpen ? <button className="navigation-backdrop" type="button" tabIndex={-1} aria-label={t("Close navigation")} onClick={closeNavigation} /> : null}
      {readerRoute ? (
        <div className="reader-navigation-zone">
          <button
            ref={navigationTriggerRef}
            className="reader-navigation-trigger"
            type="button"
            aria-label={t(readerSidebarOpen ? "Close navigation" : "Open navigation")}
            aria-expanded={readerSidebarOpen}
            aria-controls="primary-navigation"
            onClick={() => setReaderSidebarOpen((current) => !current)}
          >
            <PanelLeftOpen aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      <SidebarNavigation
        readerMode={readerRoute}
        collapsed={readerRoute || narrowNavigation ? false : normalSidebarCollapsed}
        overlayMode={narrowNavigation}
        open={sidebarOpen}
        navigationRef={navigationRef}
        onNavigate={closeNavigation}
        onToggleCollapsed={toggleNormalSidebar}
        readerPinned={readerSidebarPinned}
        onToggleReaderPinned={() => {
          setReaderSidebarPinned((current) => !current);
          setReaderSidebarOpen(true);
        }}
        onReaderClose={() => {
          closeNavigation();
          if (!narrowNavigation) navigationTriggerRef.current?.focus();
        }}
        onReaderEnter={() => setReaderSidebarOpen(true)}
        onReaderLeave={() => {
          if (!readerSidebarPinned && !navigationRef.current?.contains(document.activeElement)) setReaderSidebarOpen(false);
        }}
      />
      <div className="workspace-frame" inert={navigationModalOpen}>
        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
