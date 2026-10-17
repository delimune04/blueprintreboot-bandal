import { handleLabviumApi } from "./api.mjs";

const API_PREFIX = "/ku-ai/api";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, { method: request.method, headers: request.headers });
}

async function serveAssets(request, env, url) {
  if (!env.ASSETS?.fetch) return new Response("Static assets unavailable", { status: 503 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (url.pathname === "/ku-ai") return Response.redirect(new URL("/ku-ai/", url), 308);
  if (url.hostname === "labvium.bandal.app" && url.pathname === "/") {
    return env.ASSETS.fetch(assetRequest(request, "/ku-ai/index.html"));
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
  // Only the Labvium application owns SPA routes. Unrelated missing pages stay 404.
  if (url.pathname.startsWith("/ku-ai/") && !finalSegment.includes(".") &&
      request.headers.get("accept")?.includes("text/html")) {
    return env.ASSETS.fetch(assetRequest(request, "/ku-ai/index.html"));
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
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
