import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

import {
  initialFullTextUiState,
  transitionFullTextUiState,
} from "../app/lib/full-text/workflow-state.mjs";


function status(state, overrides = {}) {
  return {
    paper_id: "paper-1",
    state,
    extraction_state: state === "ocr_needed" ? "ocr_needed" : state === "failed" ? "failed" : state === "not_extracted" ? "not_extracted" : "success",
    source: state === "not_extracted" ? "" : "pdf-inspector",
    provider: state === "not_extracted" ? "" : "pdf-inspector",
    provider_version: "0.2.6",
    content_format: "markdown",
    classification: state === "ocr_needed" ? "mixed" : "text",
    page_count: 2,
    char_count: 12,
    ocr_needed_pages: state === "ocr_needed" ? [2] : [],
    extracted_at: "2026-08-17T00:00:00+00:00",
    has_content: state !== "not_extracted" && state !== "failed",
    is_stale: state === "stale",
    can_extract: true,
    previous_cache_preserved: false,
    message: `${state} state`,
    ...overrides,
  };
}


test("moves from not extracted through explicit extraction to a cached document", () => {
  const initial = initialFullTextUiState();
  const notExtracted = transitionFullTextUiState(initial, { type: "status-loaded", status: status("not_extracted") });
  const extracting = transitionFullTextUiState(notExtracted, { type: "operation-started" });
  const cached = transitionFullTextUiState(extracting, {
    type: "document-loaded",
    document: { ...status("cached"), content: "# Canonical text" },
    open: false,
  });

  assert.equal(notExtracted.phase, "ready");
  assert.equal(extracting.phase, "working");
  assert.equal(cached.data.state, "cached");
  assert.equal(cached.content, "# Canonical text");
  assert.equal(cached.viewerOpen, false);
});


test("opens and closes cached content without changing provider or status", () => {
  const loaded = transitionFullTextUiState(initialFullTextUiState(), {
    type: "status-loaded",
    status: status("stale"),
  });
  const opened = transitionFullTextUiState(loaded, {
    type: "document-loaded",
    document: { ...status("stale"), content: "stale but preserved" },
    open: true,
  });
  const closed = transitionFullTextUiState(opened, { type: "viewer-closed" });

  assert.equal(opened.viewerOpen, true);
  assert.equal(opened.data.state, "stale");
  assert.equal(opened.data.provider, "pdf-inspector");
  assert.equal(closed.viewerOpen, false);
  assert.equal(closed.content, "stale but preserved");
});


test("keeps the prior status and content when retry or re-extraction fails", () => {
  const ready = transitionFullTextUiState(initialFullTextUiState(), {
    type: "document-loaded",
    document: { ...status("ocr_needed"), content: "page one" },
    open: true,
  });
  const working = transitionFullTextUiState(ready, { type: "operation-started" });
  const failed = transitionFullTextUiState(working, {
    type: "operation-failed",
    message: "bounded failure",
  });

  assert.equal(failed.phase, "error");
  assert.equal(failed.data.state, "ocr_needed");
  assert.equal(failed.content, "page one");
  assert.equal(failed.viewerOpen, true);
  assert.equal(failed.message, "bounded failure");
});


test("Reader Full Text source uses the typed client and escaped text rendering", async () => {
  const [component, client, reader] = await Promise.all([
    readFile(new URL("../app/components/FullTextWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(client, /getFullTextStatus:/);
  assert.match(client, /getFullText:/);
  assert.match(client, /extractFullText:/);
  assert.match(client, /body: \{ force \}/);
  assert.match(component, /No extracted text yet/);
  assert.match(component, /Text extraction failed\. This PDF may require OCR/);
  assert.match(component, /View text/);
  assert.match(component, /Extract text/);
  assert.match(component, /Re-extract/);
  assert.match(component, /data\.page_count/);
  assert.doesNotMatch(component, /data\.provider_version/);
  assert.match(component, /<pre>\{ui\.content\}<\/pre>/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
  assert.match(reader, /<FullTextWorkspace/);
});
