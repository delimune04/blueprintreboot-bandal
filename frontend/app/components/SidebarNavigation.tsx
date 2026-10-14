"use client";

import { Compass, FolderKanban, Gauge, LibraryBig, NotebookPen, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Search, Settings, Sparkles, Tags, Users, Wrench, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageToggle, useI18n } from "../lib/i18n/LocaleProvider";
import { PRODUCT_NAME } from "../lib/i18n/catalog";
import { getWorkspaceMode } from "../lib/api/client";

const primaryNavigation = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/library", label: "Library", icon: LibraryBig },
  { href: "/workspace", label: "Research notes", icon: NotebookPen },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/search", label: "Search research", icon: Search },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/assistant", label: "Research assistant", icon: Sparkles },
  { href: "/tags", label: "Tags", icon: Tags },
];

const secondaryNavigation = [
  { href: "/team", label: "Team workspaces", icon: Users },
  { href: "/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/" || pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type SidebarNavigationProps = {
  readerMode: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  readerPinned: boolean;
  onToggleReaderPinned: () => void;
  onReaderClose: () => void;
  onReaderEnter: () => void;
  onReaderLeave: () => void;
};

export function SidebarNavigation({
  readerMode,
  collapsed,
  onToggleCollapsed,
  readerPinned,
  onToggleReaderPinned,
  onReaderClose,
  onReaderEnter,
  onReaderLeave,
}: SidebarNavigationProps) {
  const { t } = useI18n();
  const localMode = getWorkspaceMode() === "local";
  const visiblePrimary = primaryNavigation.filter((item) => !localMode || ["/dashboard", "/library", "/projects", "/tags"].includes(item.href));
  const visibleSecondary = secondaryNavigation.filter((item) => !localMode || item.href === "/settings");
  const pathname = usePathname();
  return (
    <aside
      className={readerMode ? "sidebar sidebar--reader" : "sidebar"}
      data-collapsed={collapsed}
      aria-label={t("Primary navigation")}
      onMouseEnter={readerMode ? onReaderEnter : undefined}
      onMouseLeave={readerMode ? onReaderLeave : undefined}
    >
      <div className="sidebar__header">
        <Link href="/dashboard" className="brand" aria-label={`${PRODUCT_NAME} · ${t("Dashboard")}`}>
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__copy"><strong>{PRODUCT_NAME}</strong><small>{t("Research workspace")}</small></span>
        </Link>
        {readerMode ? (
          <div className="sidebar__reader-actions">
            <button className="sidebar-toggle" type="button" onClick={onToggleReaderPinned} aria-pressed={readerPinned} aria-label={t(readerPinned ? "Unpin navigation" : "Pin navigation")} title={t(readerPinned ? "Unpin navigation" : "Pin navigation")}>
              {readerPinned ? <PinOff aria-hidden="true" size={16} /> : <Pin aria-hidden="true" size={16} />}
              <span className="sidebar-toggle__label">{t(readerPinned ? "Unpin" : "Pin")}</span>
            </button>
            <button className="sidebar-toggle sidebar-toggle--icon" type="button" onClick={onReaderClose} aria-label={t("Close navigation")} title={t("Close navigation")}>
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ) : (
          <button className="sidebar-toggle sidebar-toggle--icon" type="button" onClick={onToggleCollapsed} aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")} title={t(collapsed ? "Expand sidebar" : "Collapse sidebar")}>
            {collapsed ? <PanelLeftOpen aria-hidden="true" size={16} /> : <PanelLeftClose aria-hidden="true" size={16} />}
          </button>
        )}
      </div>
      <nav id="primary-navigation" className="sidebar-nav">
        {visiblePrimary.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} className="sidebar-link" data-active={active} aria-current={active ? "page" : undefined} aria-label={collapsed ? t(label) : undefined} title={collapsed ? t(label) : undefined}>
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>{t(label)}</span>
            </Link>
          );
        })}
      </nav>
      <nav className="sidebar-nav sidebar-nav--secondary" aria-label={t("Workspace settings")}>
        {visibleSecondary.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} className="sidebar-link" data-active={active} aria-current={active ? "page" : undefined} aria-label={collapsed ? t(label) : undefined} title={collapsed ? t(label) : undefined}>
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>{t(label)}</span>
            </Link>
          );
        })}
      </nav>
      {!collapsed ? <LanguageToggle /> : null}
    </aside>
  );
}
