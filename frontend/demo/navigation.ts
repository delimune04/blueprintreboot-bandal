import { useMemo, useSyncExternalStore } from "react";

export const DEMO_BASE = "/ku-ai/";
const NAVIGATION_EVENT = "bandal-demo:navigation";
let lastRoute = "/dashboard";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
  };
}

function readRoute() {
  if (typeof window === "undefined") return "/dashboard";
  const hash = window.location.hash.slice(1);
  if (!hash) lastRoute = "/dashboard";
  if (hash.startsWith("/")) lastRoute = hash;
  return lastRoute;
}

export function useDemoRoute() {
  return useSyncExternalStore(subscribe, readRoute, () => "/dashboard");
}

export function usePathname() {
  const route = useDemoRoute();
  return route.split(/[?#]/, 1)[0] || "/dashboard";
}

export function useSearchParams() {
  const route = useDemoRoute();
  const query = route.includes("?") ? route.slice(route.indexOf("?") + 1).split("#", 1)[0] : "";
  // Reader uses this object as a memo/effect dependency. Keep its identity
  // stable while the route's query string is unchanged.
  return useMemo(() => new URLSearchParams(query), [query]);
}

type HrefObject = { pathname?: string | null; query?: Record<string, unknown> | null; hash?: string | null };
export type DemoHref = string | HrefObject;

function hrefString(href: DemoHref) {
  if (typeof href === "string") return href;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));
    else search.set(key, String(value));
  }
  const query = search.toString();
  return `${href.pathname || currentPathname()}${query ? `?${query}` : ""}${href.hash || ""}`;
}

function currentPathname() {
  return readRoute().split(/[?#]/, 1)[0];
}

export function demoHref(href: DemoHref) {
  const value = hrefString(href);
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || value.startsWith("#")) return value;
  if (value.startsWith(`${DEMO_BASE}#`)) return value;
  const withoutBase = value.startsWith(DEMO_BASE) ? `/${value.slice(DEMO_BASE.length)}` : value;
  const current = new URL(readRoute(), "https://demo.invalid");
  const route = new URL(withoutBase, current);
  return `${DEMO_BASE}#${route.pathname}${route.search}${route.hash}`;
}

function navigate(href: string, replace: boolean, options?: { scroll?: boolean }) {
  const target = demoHref(href);
  if (!target.startsWith(`${DEMO_BASE}#`)) {
    if (replace) window.location.replace(target);
    else window.location.assign(target);
    return;
  }
  if (replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
  if (options?.scroll !== false) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

const router = {
  push: (href: string, options?: { scroll?: boolean }) => navigate(href, false, options),
  replace: (href: string, options?: { scroll?: boolean }) => navigate(href, true, options),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => window.location.reload(),
  prefetch: async (href: string) => { void href; },
};

export function useRouter() {
  return router;
}
