import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

import {
  candidateReviewLoadFailure,
  createLatestPaperRequestGate,
  initialCandidateReview,
  savedCandidateReviewReady,
} from "../app/lib/reader/candidate-review-lifecycle.mjs";
import {
  DEFAULT_RESEARCH_PANEL_WIDTH,
  MAX_RESEARCH_PANEL_WIDTH,
  MIN_RESEARCH_PANEL_WIDTH,
  researchPanelWidthFromPointer,
} from "../app/lib/reader/split-pane.mjs";
import {
  createPdfViewportAnchor,
  scrollTopForPdfViewportAnchor,
} from "../app/lib/pdf/resize-anchor.mjs";

test("Reader split-pane pointer width stays within its practical PDF and Research limits", () => {
  assert.equal(DEFAULT_RESEARCH_PANEL_WIDTH, 400);
  assert.equal(researchPanelWidthFromPointer({ containerRight: 1200, clientX: 800, minimum: MIN_RESEARCH_PANEL_WIDTH, maximum: MAX_RESEARCH_PANEL_WIDTH }), 400);
  assert.equal(researchPanelWidthFromPointer({ containerRight: 1200, clientX: 1100, minimum: MIN_RESEARCH_PANEL_WIDTH, maximum: MAX_RESEARCH_PANEL_WIDTH }), MIN_RESEARCH_PANEL_WIDTH);
  assert.equal(researchPanelWidthFromPointer({ containerRight: 1200, clientX: 400, minimum: MIN_RESEARCH_PANEL_WIDTH, maximum: MAX_RESEARCH_PANEL_WIDTH }), MAX_RESEARCH_PANEL_WIDTH);
});

test("PDF resize anchor keeps the same page-relative viewport location after its rendered height changes", () => {
  const anchor = createPdfViewportAnchor({
    pageNumber: 7,
    pageTop: 6000,
    pageHeight: 1200,
    viewportTop: 6200,
    viewportHeight: 800,
  });
  assert.equal(anchor.pageNumber, 7);
  assert.equal(anchor.relativePageOffset, 0.5);
  assert.equal(anchor.viewportAnchorOffset, 400);

  const restoredScrollTop = scrollTopForPdfViewportAnchor({
    pageTop: 7000,
    pageHeight: 1600,
    relativePageOffset: anchor.relativePageOffset,
    viewportAnchorOffset: anchor.viewportAnchorOffset,
  });
  assert.equal(restoredScrollTop, 7400);
  assert.equal((restoredScrollTop + anchor.viewportAnchorOffset - 7000) / 1600, 0.5);
});

test("Review Suggestions lifecycle exits loading for results, an empty saved collection, and failure", () => {
  const generatedWithResults = savedCandidateReviewReady({ state: "generated", items: [{ candidate_id: "one" }] });
  assert.equal(generatedWithResults.status, "ready");
  assert.match(generatedWithResults.message, /ready to review/);

  const generatedEmpty = savedCandidateReviewReady({ state: "generated", items: [] });
  assert.equal(generatedEmpty.status, "ready");
  assert.match(generatedEmpty.message, /No saved suggestions/);

  const notGenerated = savedCandidateReviewReady({ state: "not_generated", items: [] });
  assert.equal(notGenerated.status, "ready");
  assert.match(notGenerated.message, /Generate suggestions/);

  const failure = candidateReviewLoadFailure();
  assert.equal(failure.status, "error");
  assert.match(failure.message, /could not be loaded/);
  assert.equal(initialCandidateReview().status, "idle");
});

test("Review Suggestions request gate ignores stale and superseded Paper responses", () => {
  const gate = createLatestPaperRequestGate();
  const firstPaperRequest = gate.begin("paper-a");
  assert.equal(gate.isCurrent(firstPaperRequest), true);

  const retryRequest = gate.begin("paper-a");
  assert.equal(gate.isCurrent(firstPaperRequest), false);
  assert.equal(gate.isCurrent(retryRequest), true);

  gate.invalidate("paper-b");
  assert.equal(gate.isCurrent(retryRequest), false);
  const secondPaperRequest = gate.begin("paper-b");
  assert.equal(gate.isCurrent(secondPaperRequest), true);
});

test("Reader binds the interaction helpers to Pointer Events, explicit navigation, and retryable candidate state", async () => {
  const [reader, pdfReader, shell, css, client] = await Promise.all([
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PdfJsReader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reader, /setPointerCapture\(event\.pointerId\)/);
  assert.match(reader, /onPointerMove=\{moveResearchPanelResize\}/);
  assert.match(reader, /onPointerCancel=\{endResearchPanelResize\}/);
  assert.match(reader, /researchPanelWidthFromPointer/);
  assert.match(reader, /capturePdfLayoutAnchorRef\.current\?\.\(\)/);
  assert.doesNotMatch(reader, /type="range"/);
  assert.match(pdfReader, /createPdfViewportAnchor/);
  assert.match(pdfReader, /scrollTopForPdfViewportAnchor/);
  assert.match(pdfReader, /layoutResizeActive/);
  assert.match(pdfReader, /pendingLayoutAnchorRef/);
  assert.match(reader, /createLatestPaperRequestGate/);
  assert.match(reader, /candidateAbortControllerRef/);
  assert.match(reader, /Retry loading suggestions/);
  assert.match(reader, /\.finally\(\(\) =>/);
  assert.match(client, /signal: options\.signal/);

  assert.doesNotMatch(shell, /onMouseEnter=\{\(\) => setReaderSidebarOpen\(true\)\}/);
  assert.match(shell, /onClick=\{\(\) => setReaderSidebarOpen/);
  assert.match(css, /\.reader-navigation-zone \{[^}]*pointer-events: none/);
  assert.match(css, /\.reader-navigation-trigger \{[^}]*pointer-events: auto/);
  assert.match(css, /\.reader-panel-resize \{[^}]*cursor: col-resize/);
});
