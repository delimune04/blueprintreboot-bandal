import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearPersistentRevisionDraft,
  configureDraftWorkspaceScope,
  createRevisionDraftState,
  draftStorageKey,
  editRevisionDraft,
  persistRevisionDraft,
  readPersistentRevisionDraft,
} from "../app/lib/drafts/revision-draft.mjs";
import {
  appendReaderHighlight,
  configureReaderWorkspaceScope,
  readReaderPreferences,
  readerPreferenceKey,
  updateReaderPreferences,
} from "../app/lib/reader/browser-reader-state.mjs";

const ALICE = "a".repeat(64), BOB = "b".repeat(64), SHARED = "c".repeat(64), OTHER = "d".repeat(64);
const accountScope = (actor, workspace = SHARED) => `${actor}:${workspace}`;
function storage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
function draft(value) { return editRevisionDraft(createRevisionDraftState({ draft: "Saved baseline", revision: "revision-1" }), value); }
function selection(text, pageNumber = 1) {
  return { pageNumber, coordinateSpace: "page-normalized", text, rectangles: [{ x: .1, y: .1, width: .2, height: .04 }] };
}
afterEach(() => { configureDraftWorkspaceScope(""); configureReaderWorkspaceScope(""); });

test("two accounts editing the same shared paper retain separate drafts and the legacy guest record", () => {
  const saved = storage();
  configureDraftWorkspaceScope("");
  const guestKey = draftStorageKey("paper-note", "paper-1");
  assert.equal(guestKey, "blueprint-reboot:draft:v1:paper-note:paper-1");
  assert.ok(persistRevisionDraft(saved, guestKey, draft("Guest draft")));
  const guestBytes = saved.getItem(guestKey);

  configureDraftWorkspaceScope(accountScope(ALICE));
  const aliceKey = draftStorageKey("paper-note", "paper-1");
  assert.equal(readPersistentRevisionDraft(saved, aliceKey), null, "cloud mode must not import the guest draft implicitly");
  persistRevisionDraft(saved, aliceKey, draft("Alice private unfinished reasoning"));

  configureDraftWorkspaceScope(accountScope(BOB));
  const bobKey = draftStorageKey("paper-note", "paper-1");
  assert.notEqual(bobKey, aliceKey);
  assert.equal(readPersistentRevisionDraft(saved, bobKey), null, "a second account must not inherit the first account's unfinished work");
  persistRevisionDraft(saved, bobKey, draft("Bob independent reasoning"));
  assert.equal(readPersistentRevisionDraft(saved, bobKey).draft, "Bob independent reasoning");

  configureDraftWorkspaceScope(accountScope(ALICE));
  assert.equal(readPersistentRevisionDraft(saved, draftStorageKey("paper-note", "paper-1")).draft, "Alice private unfinished reasoning");
  assert.equal(saved.getItem(guestKey), guestBytes);
  configureDraftWorkspaceScope("");
  assert.equal(readPersistentRevisionDraft(saved, draftStorageKey("paper-note", "paper-1")).draft, "Guest draft");
});

test("saving or clearing one account draft never clears another account or guest draft", () => {
  const saved = storage(), keys = [];
  for (const [scope, value] of [["", "Guest"], [accountScope(ALICE), "Alice"], [accountScope(BOB), "Bob"]]) {
    configureDraftWorkspaceScope(scope);
    const key = draftStorageKey("note-block", "paper-1:block-1");
    persistRevisionDraft(saved, key, draft(value));
    keys.push(key);
  }
  const guestBytes = saved.getItem(keys[0]), aliceBytes = saved.getItem(keys[1]);
  configureDraftWorkspaceScope(accountScope(BOB));
  assert.ok(persistRevisionDraft(saved, draftStorageKey("note-block", "paper-1:block-1"), createRevisionDraftState({ draft: "Bob saved", revision: "revision-2" })));
  assert.equal(saved.getItem(keys[2]), null);
  assert.equal(saved.getItem(keys[1]), aliceBytes);
  assert.equal(saved.getItem(keys[0]), guestBytes);
  persistRevisionDraft(saved, keys[2], draft("Bob retry"));
  assert.ok(clearPersistentRevisionDraft(saved, draftStorageKey("note-block", "paper-1:block-1")));
  assert.equal(saved.getItem(keys[1]), aliceBytes);
  assert.equal(saved.getItem(keys[0]), guestBytes);
});

test("one account's different workspaces and draft types cannot collide", () => {
  configureDraftWorkspaceScope(accountScope(ALICE));
  const sharedNote = draftStorageKey("paper-note", "paper-1");
  const sharedMetadata = draftStorageKey("paper-metadata", "paper-1");
  configureDraftWorkspaceScope(accountScope(ALICE, OTHER));
  const otherNote = draftStorageKey("paper-note", "paper-1");
  assert.equal(new Set([sharedNote, sharedMetadata, otherNote]).size, 3);
});

test("Reader pages and highlighted evidence are isolated for two accounts in one shared workspace", () => {
  const saved = storage();
  configureReaderWorkspaceScope("");
  const guestKey = readerPreferenceKey("paper-1");
  assert.equal(guestKey, "bandal.reader.preferences.v1:paper-1");
  updateReaderPreferences(saved, "paper-1", (state) => appendReaderHighlight({ ...state, page: 7 }, selection("Guest evidence", 7), "guest-highlight"));
  const guestBytes = saved.getItem(guestKey);

  configureReaderWorkspaceScope(accountScope(ALICE));
  const aliceKey = readerPreferenceKey("paper-1");
  assert.deepEqual(readReaderPreferences(saved, "paper-1").value, { version: 1, page: 1, highlights: [] });
  assert.ok(updateReaderPreferences(saved, "paper-1", (state) => appendReaderHighlight({ ...state, page: 3 }, selection("Alice pending evidence", 3), "alice-highlight")).ok);

  configureReaderWorkspaceScope(accountScope(BOB));
  const bobKey = readerPreferenceKey("paper-1");
  assert.notEqual(bobKey, aliceKey);
  assert.deepEqual(readReaderPreferences(saved, "paper-1").value, { version: 1, page: 1, highlights: [] });
  assert.ok(updateReaderPreferences(saved, "paper-1", (state) => appendReaderHighlight({ ...state, page: 5 }, selection("Bob evidence", 5), "bob-highlight")).ok);

  configureReaderWorkspaceScope(accountScope(ALICE));
  const alice = readReaderPreferences(saved, "paper-1");
  assert.equal(alice.value.page, 3);
  assert.equal(alice.value.highlights[0].text, "Alice pending evidence");
  configureReaderWorkspaceScope(accountScope(BOB));
  assert.equal(readReaderPreferences(saved, "paper-1").value.highlights[0].text, "Bob evidence");
  assert.equal(saved.getItem(guestKey), guestBytes);
  configureReaderWorkspaceScope("");
  assert.equal(readReaderPreferences(saved, "paper-1").value.page, 7);
});

test("cloud scope creation preserves corrupt legacy Reader and draft bytes without migrating or overwriting them", () => {
  const saved = storage();
  configureDraftWorkspaceScope(""); configureReaderWorkspaceScope("");
  const guestDraftKey = draftStorageKey("paper-note", "paper-1"), guestReaderKey = readerPreferenceKey("paper-1");
  saved.setItem(guestDraftKey, "broken legacy draft bytes");
  saved.setItem(guestReaderKey, "broken legacy Reader bytes");
  configureDraftWorkspaceScope(accountScope(ALICE)); configureReaderWorkspaceScope(accountScope(ALICE));
  const cloudKey = draftStorageKey("paper-note", "paper-1");
  assert.equal(readPersistentRevisionDraft(saved, cloudKey), null);
  assert.ok(persistRevisionDraft(saved, cloudKey, draft("New cloud-only draft")));
  assert.ok(updateReaderPreferences(saved, "paper-1", (state) => ({ ...state, page: 2 })).ok);
  assert.equal(saved.getItem(guestDraftKey), "broken legacy draft bytes");
  assert.equal(saved.getItem(guestReaderKey), "broken legacy Reader bytes");
  configureDraftWorkspaceScope(""); configureReaderWorkspaceScope("");
  assert.equal(readPersistentRevisionDraft(saved, guestDraftKey), null);
  assert.equal(readReaderPreferences(saved, "paper-1").ok, false);
  assert.equal(saved.getItem(guestDraftKey), "broken legacy draft bytes");
  assert.equal(saved.getItem(guestReaderKey), "broken legacy Reader bytes");
});
