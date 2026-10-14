import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

const sources = Promise.all([
  readFile(new URL("../app/components/NoteBlocksWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ProjectDetailView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("Reader exposes explicit structured Note Block create, edit, cancel, reload, and save", async () => {
  const [workspace, reader, , client] = await sources;
  for (const label of ["Add", "Edit", "Save Note Block", "Cancel", "Reload collection", "Details"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(reader, /NoteBlocksWorkspace/);
  assert.match(client, /getNoteBlocks/);
  assert.match(client, /createNoteBlock/);
  assert.match(client, /updateNoteBlock/);
  assert.doesNotMatch(workspace, /autoSave\s*=|onBlur=.*(?:create|update)NoteBlock|setInterval/i);
  assert.match(workspace, /apiClient\.deleteNoteBlock/);
  assert.match(workspace, /window\.confirm/);
  assert.doesNotMatch(workspace, /reorder|drag/i);
});

test("Reader distinguishes Note Block loading, empty, unavailable, error, and success states", async () => {
  const [workspace] = await sources;
  assert.match(workspace, /status: "loading"/);
  assert.match(workspace, /<LoadingState/);
  assert.match(workspace, /<EmptyState/);
  assert.match(workspace, /<UnavailableState/);
  assert.match(workspace, /<ErrorState/);
  assert.match(workspace, /status: "ready"/);
});

test("Note Block conflict and API failure preserve drafts and reload independently", async () => {
  const [workspace, reader] = await sources;
  assert.match(workspace, /failRevisionSave/);
  assert.match(workspace, /persistRevisionDraft/);
  assert.match(workspace, /keepMyRevisionDraft/);
  assert.match(workspace, /Reload current collection/);
  assert.match(workspace, /Your Project and link-type selection is preserved/);
  assert.match(workspace, /draft and the latest saved block are both preserved/);
  assert.match(reader, /<NoteBlocksWorkspace key=\{snapshot\.paper\.paper_id\}/);
  assert.match(reader, /createReaderEditorState/);
  assert.match(reader, /editor\.metadata/);
  assert.match(reader, /editor\.note/);
});

test("Reader Project linking loads every page, stays duplicate-truthful, confirmed, and non-destructive", async () => {
  const [workspace, , , client] = await sources;
  assert.match(workspace, /apiClient\.getAllProjects\(\)/);
  assert.match(client, /collectAllPaginatedItems\(getProjects\)/);
  assert.match(workspace, /project\.status !== "archived"/);
  assert.match(workspace, /exact Note Block link already exists; nothing was written/);
  assert.match(workspace, /window\.confirm/);
  assert.match(workspace, /Note Block and Paper will remain/);
  assert.match(client, /addProjectNoteBlockLink/);
  assert.match(client, /removeProjectNoteBlockLink/);
});

test("Reader Note Block Project linking has a shrinkable, panel-responsive form layout", async () => {
  const [workspace, , , , styles] = await sources;
  assert.match(workspace, /project-link-form project-link-form--note-block/);
  assert.match(styles, /\.project-link-form \{ min-width: 0; display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 0\.45fr\) auto;/);
  assert.match(styles, /\.project-link-form > \*, \.project-link-form \.reader-field \{ min-width: 0; max-width: 100%; \}/);
  assert.match(styles, /\.project-link-form \.reader-field :is\(input, select, textarea\) \{ width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; \}/);
  assert.match(styles, /\.project-link-form--note-block \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 11rem\), 1fr\)\); \}/);
  assert.match(styles, /\.note-block-list \{ min-width: 0; display: grid;/);
  assert.match(styles, /\.note-block-card \{ min-width: 0; display: grid;/);
});

test("Project Detail renders typed Note Block data, orphan state, and stable Reader navigation", async () => {
  const [, , detail] = await sources;
  assert.match(detail, /Linked Papers/);
  assert.match(detail, /Linked Note Blocks/);
  assert.match(detail, /link\.note_block/);
  assert.match(detail, /text_preview/);
  assert.match(detail, /targetStateTone\(link\.target_state\)/);
  assert.match(detail, /\/reader\?noteBlock=/);
  assert.match(detail, /link\.target_id/);
  assert.match(detail, /removeProjectNoteBlockLink/);
  assert.match(detail, /disabled=\{linkStatus === "saving" \|\| dirty\}/);
});
