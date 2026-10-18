import { useMemo, useSyncExternalStore } from "react";

export const DEMO_BASE = "/LabVium";
const LEGACY_BASE = "/ku-ai";
const NAVIGATION_EVENT = "bandal-demo:navigation";
const ROUTE_ORIGIN = "https://labvium.invalid";

function isMounted(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function routePath(pathname: string) {
  for (const base of [DEMO_BASE, LEGACY_BASE]) {
    if (isMounted(pathname, base)) return pathname.slice(base.length) || "/";
  }
  return "/";
}

function subscribe(listener: () => void) {
  const onRouteChange = () => {
    // Back may revisit an entry created by a cached version of the hash client.
    migrateLegacyRoute();
    listener();
  };
  window.addEventListener("hashchange", onRouteChange);
  window.addEventListener("popstate", onRouteChange);
  window.addEventListener(NAVIGATION_EVENT, onRouteChange);
  return () => {
    window.removeEventListener("hashchange", onRouteChange);
    window.removeEventListener("popstate", onRouteChange);
    window.removeEventListener(NAVIGATION_EVENT, onRouteChange);
  };
}

export function readRoute() {
  if (typeof window === "undefined") return "/dashboard";
  const { pathname, search, hash } = window.location;
  return `${routePath(pathname)}${search}${hash}`;
}

function mountedRoute(route: URL) {
  const pathname = route.pathname === "/" ? DEMO_BASE : `${DEMO_BASE}${route.pathname}`;
  return `${pathname}${route.search}${route.hash}`;
}

// Run before mounting React so old bookmarks keep their route without adding a
// redundant entry to Back history. Only root #/ links are legacy app routes;
// document anchors and protocol-relative strings are never redirect targets.
export function migrateLegacyRoute() {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (!isMounted(pathname, DEMO_BASE) && !isMounted(pathname, LEGACY_BASE)) return;
  const path = routePath(pathname);
  const fragment = hash.slice(1);
  let route = new URL(`${path}${search}${hash}`, ROUTE_ORIGIN);
  if (path === "/" && fragment.startsWith("/") && !fragment.startsWith("//") && !fragment.includes("\\")) {
    route = new URL(fragment, ROUTE_ORIGIN);
    const outerSearch = new URLSearchParams(search);
    const routeKeys = new Set(route.searchParams.keys());
    for (const [key, value] of outerSearch) {
      if (!routeKeys.has(key)) route.searchParams.append(key, value);
    }
  }
  const target = mountedRoute(route);
  if (`${pathname}${search}${hash}` !== target) window.history.replaceState(window.history.state, "", target);
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
  const query = new URL(route, ROUTE_ORIGIN).search.slice(1);
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
    if (Array.isArray(value)) value.filter(item => item != null).forEach(item => search.append(key, String(item)));
    else search.set(key, String(value));
  }
  const query = search.toString();
  const hash = href.hash ? `#${href.hash.replace(/^#/, "")}` : "";
  return `${href.pathname || currentPathname()}${query ? `?${query}` : ""}${hash}`;
}

function currentPathname() {
  return readRoute().split(/[?#]/, 1)[0];
}

export function isDemoHref(value: string) {
  if (/[\\\u0000-\u0020\u007f]/.test(value) || !value.startsWith("/")) return false;
  try {
    const route = new URL(value, ROUTE_ORIGIN);
    return route.origin === ROUTE_ORIGIN && isMounted(route.pathname, DEMO_BASE);
  } catch {
    return false;
  }
}

export function demoHref(href: DemoHref) {
  const value = hrefString(href);
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || value.startsWith("#")) return value;
  // Reject URL syntax that a browser could reinterpret as an external origin.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return "#";
  const source = new URL(value, new URL(readRoute(), ROUTE_ORIGIN));
  if (source.origin !== ROUTE_ORIGIN) return value;
  let path = source.pathname;
  for (const base of [DEMO_BASE, LEGACY_BASE]) {
    if (!isMounted(path, base)) continue;
    path = path.slice(base.length) || "/";
    // Preserve old in-app links, as well as bookmarks handled at startup.
    if (path === "/" && source.hash.startsWith("#/") && !source.hash.startsWith("#//")) {
      const legacy = new URL(source.hash.slice(1), ROUTE_ORIGIN);
      if (legacy.origin === ROUTE_ORIGIN) {
        const routeKeys = new Set(legacy.searchParams.keys());
        for (const [key, value] of source.searchParams) {
          if (!routeKeys.has(key)) legacy.searchParams.append(key, value);
        }
        return mountedRoute(legacy);
      }
    }
    break;
  }
  const route = new URL(`${path}${source.search}${source.hash}`, ROUTE_ORIGIN);
  return mountedRoute(route);
}

function navigate(href: DemoHref, replace: boolean, options?: { scroll?: boolean }) {
  const target = demoHref(href);
  if (!isDemoHref(target)) {
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
  push: (href: DemoHref, options?: { scroll?: boolean }) => navigate(href, false, options),
  replace: (href: DemoHref, options?: { scroll?: boolean }) => navigate(href, true, options),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => window.location.reload(),
  prefetch: async (href: DemoHref) => { void href; },
};

export function useRouter() {
  return router;
}
