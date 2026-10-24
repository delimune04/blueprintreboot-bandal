import { handleLabviumApi } from "./api.mjs";
import { handleMoaflowApi } from "./moaflow/api.mjs";
import { handleFinanceApi } from "./finance/api.mjs";

const APP_PREFIX = "/LabVium";
const LEGACY_PREFIX = "/ku-ai";
const API_PREFIXES = [`${APP_PREFIX}/api`, `${LEGACY_PREFIX}/api`];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ASSET_DIRECTORIES = new Set(["assets", "brand", "help", "bandal-demo", "pdfjs", "ocr"]);

function apiError(status, code, detail) {
  return Response.json({ detail, error: { code, message: detail } }, {
    status,
    headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" },
  });
}

function sameOriginWrite(request, url) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return site !== "cross-site" && site !== "same-site";
}

function mountedAt(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, { method: request.method, headers: request.headers });
}

function redirectPath(url, pathname) {
  // Assign pathname rather than resolve a caller-controlled relative URL: even
  // a path with double slashes cannot change the destination origin.
  const target = new URL(url.origin);
  target.pathname = pathname;
  target.search = url.search;
  return Response.redirect(target, 308);
}

function spaPath(pathname, prefix) {
  const relative = pathname.slice(prefix.length).replace(/^\//, "");
  let parts;
  try { parts = relative.split("/").map(decodeURIComponent); } catch { return false; }
  if (parts.some(part => /[\\/\u0000-\u001f]/.test(part) || part === "." || part === "..")) return false;
  // Missing public files and protected API routes must never become HTML.
  if (parts[0] === "api" || ASSET_DIRECTORIES.has(parts[0])) return false;
  return !parts.filter(Boolean).at(-1)?.includes(".");
}

async function serveAssets(request, env, url) {
  if (!env.ASSETS?.fetch) return new Response("Static assets unavailable", { status: 503 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (url.hostname === "labvium.bandal.app" && url.pathname === "/") {
    // Keep this already-supported origin so browser-local research remains
    // reachable. Only the BANDAL path is being renamed in this release.
    return env.ASSETS.fetch(assetRequest(request, `${LEGACY_PREFIX}/index.html`));
  }
  if (url.pathname === `${APP_PREFIX}/` || url.pathname === `${APP_PREFIX}/index.html`) {
    return redirectPath(url, APP_PREFIX);
  }
  if (mountedAt(url.pathname, LEGACY_PREFIX) &&
      (url.pathname === `${LEGACY_PREFIX}/index.html` || spaPath(url.pathname, LEGACY_PREFIX))) {
    const suffix = url.pathname === `${LEGACY_PREFIX}/index.html` ? "" : url.pathname.slice(LEGACY_PREFIX.length).replace(/\/$/, "");
    return redirectPath(url, `${APP_PREFIX}${suffix}`);
  }
  // The public URL changes, while the physical asset tree and all private
  // bindings stay in place. Existing /ku-ai asset and PDF bookmarks still work.
  if (mountedAt(url.pathname, APP_PREFIX)) {
    if (url.pathname === APP_PREFIX) return env.ASSETS.fetch(assetRequest(request, `${LEGACY_PREFIX}/index.html`));
    const physicalPath = `${LEGACY_PREFIX}${url.pathname.slice(APP_PREFIX.length)}`;
    const response = await env.ASSETS.fetch(assetRequest(request, physicalPath));
    if (response.status !== 404) return response;
    if (spaPath(url.pathname, APP_PREFIX) && request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(assetRequest(request, `${LEGACY_PREFIX}/index.html`));
    }
    return response;
  }
  let response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;
  // Preserve the existing static site's directory-index routes, including the
  // homepage, privacy pages and Harupyeon articles, without a global SPA fallback.
  const finalSegment = url.pathname.split("/").at(-1) || "";
  if (!finalSegment.includes(".")) {
    const indexPath = `${url.pathname.replace(/\/$/, "")}/index.html`;
    response = await env.ASSETS.fetch(assetRequest(request, indexPath));
    if (response.status !== 404) return response;
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (mountedAt(url.pathname, "/finance/api")) return handleFinanceApi(request, env, ctx);
    if (url.pathname === "/finance") return redirectPath(url, "/finance/");
    if (mountedAt(url.pathname, "/finance")) {
      const response = await serveAssets(request, env, url);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (mountedAt(url.pathname, "/moaflow/api")) return handleMoaflowApi(request, env, ctx);
    if (url.pathname === "/moaflow") return redirectPath(url, "/moaflow/");
    if (mountedAt(url.pathname, "/moaflow")) {
      const response = await serveAssets(request, env, url);
      const headers = new Headers(response.headers);
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
      if (url.pathname.endsWith("sw.js")) headers.set("Cache-Control", "no-cache");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    if (API_PREFIXES.some(prefix => mountedAt(url.pathname, prefix))) {
      // Sites dispatch, rather than browser JSON or URL parameters, supplies
      // this trusted identity header. Public anonymous visitors remain read-only.
      if (!SAFE_METHODS.has(request.method)) {
        if (!request.headers.get("oai-authenticated-user-id")) {
          return apiError(401, "authentication_required", "Sign in with ChatGPT to save your workspace.");
        }
        if (!sameOriginWrite(request, url)) {
          return apiError(403, "cross_origin_write", "Workspace changes must come from this site.");
        }
      }
      try {
        return await handleLabviumApi(request, env, ctx);
      } catch {
        return apiError(500, "internal_error", "The request could not be completed. Please try again.");
      }
    }
    return serveAssets(request, env, url);
  },
};
