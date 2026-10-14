import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

import {
  readerResearchTabFromSearchParams,
  readerUtilityFromSearchParams,
} from "../app/lib/reader/reader-route-state.mjs";
import { trapModalFocus } from "../app/lib/accessibility/modal-focus.mjs";

function focusable(name) {
  return {
    name,
    focusCalls: 0,
    hasAttribute: () => false,
    focus() { this.focusCalls += 1; },
  };
}

function keyboardEvent({ shiftKey = false } = {}) {
  return {
    key: "Tab",
    shiftKey,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

test("Reader route state keeps ordinary entry on Note and opens Blocks for a Note Block link", () => {
  assert.equal(readerResearchTabFromSearchParams(new URLSearchParams()), "note");
  assert.equal(readerResearchTabFromSearchParams(new URLSearchParams("noteBlock=block-123")), "blocks");
  assert.equal(readerUtilityFromSearchParams(new URLSearchParams()), null);
  assert.equal(readerUtilityFromSearchParams(new URLSearchParams("utility=tags")), "tags");
  assert.equal(readerUtilityFromSearchParams(new URLSearchParams("utility=full-text")), "full-text");
});

test("modal keyboard trapping wraps Tab and Shift+Tab inside the active dialog", () => {
  const first = focusable("first");
  const last = focusable("last");
  let activeElement = last;
  const dialog = {
    querySelectorAll: () => [first, last],
    contains: (element) => element === first || element === last,
    ownerDocument: { get activeElement() { return activeElement; } },
  };

  const tab = keyboardEvent();
  assert.equal(trapModalFocus(tab, dialog), true);
  assert.equal(tab.prevented, true);
  assert.equal(first.focusCalls, 1);

  activeElement = first;
  const shiftTab = keyboardEvent({ shiftKey: true });
  assert.equal(trapModalFocus(shiftTab, dialog), true);
  assert.equal(shiftTab.prevented, true);
  assert.equal(last.focusCalls, 1);
});

test("requested workflow changes remain lazy, focused, and bounded to the selected UI", async () => {
  const [reader, blocks, project, dashboard, client, tags, paperDetail, modalHook] = await Promise.all([
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/NoteBlocksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ProjectDetailView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/DashboardView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/PaperDetailView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/useModalFocus.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reader, /blocksVisited/);
  assert.match(reader, /activeResearchTab === "blocks"/);
  assert.match(reader, /focusBlockId=\{noteBlockId\}/);
  assert.match(reader, /activeUtility !== "tags" \|\| tagBook\.status !== "idle"/);
  assert.match(reader, /activeUtility !== "tags" \|\| candidateReview\.status !== "idle"/);
  assert.match(blocks, /target\.scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(blocks, /target\.focus\(\{ preventScroll: true \}\)/);

  assert.match(project, /const preserveLocalDraft = changedProjectFields/);
  assert.match(project, /editorRef\.current/);
  assert.match(project, /paperLinkPaperId/);
  assert.match(project, /paperLinkType/);
  assert.match(project, /noteBlockPaperId/);
  assert.match(project, /noteBlockLinkType/);
  assert.doesNotMatch(project, /const \[paperId, setPaperId\]/);
  assert.doesNotMatch(project, /const \[linkType, setLinkType\]/);

  assert.match(client, /getPapers\(\{ limit: 5, offset: 0, archiveStatus: "active", status: "reading" \}\)/);
  assert.doesNotMatch(dashboard, /sort\(\(left, right\) => Number\(right\.status === "reading"\)/);
  assert.doesNotMatch(tags, /apiClient\.getAllTags\(\)/);
  assert.match(paperDetail, /Open Library Scan/);
  assert.match(paperDetail, /Review diagnostics/);
  assert.match(modalHook, /trapModalFocus/);
  assert.match(modalHook, /event\.key === "Escape"/);
  assert.match(modalHook, /modalRestoreTarget\(next\?\.dialog, restoreTarget, previousTarget\)/);
  assert.match(modalHook, /target\?\.focus\(\)/);
  assert.match(modalHook, /if \(!modalFocusStack\.isTop\(entry\)\) return/);
});
