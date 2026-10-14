import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";
import {
  inferredStatusMarkerTone,
  relationshipTone,
  statusMarkerTone,
  systemStateTone,
} from "../app/lib/semantic-tones.mjs";
import {
  patchPaperReadingStatus,
  patchReadingStatusCollection,
  readingStatusChangeRequiresCollectionRefresh,
} from "../app/lib/library/reading-status-collection.mjs";

test("semantic tones distinguish reading, project, priority, health, and relationships", () => {
  assert.equal(statusMarkerTone("unread"), "slate");
  assert.equal(statusMarkerTone("reading"), "blue");
  assert.equal(statusMarkerTone("finished"), "green");
  assert.equal(statusMarkerTone("paused"), "amber");
  assert.equal(statusMarkerTone("critical"), "rose");
  assert.equal(systemStateTone("healthy"), "green");
  assert.equal(systemStateTone("offline"), "rose");
  assert.equal(relationshipTone("related"), "slate");
  assert.equal(relationshipTone("key_reference"), "violet");
  assert.equal(relationshipTone("supports_project"), "green");
  assert.equal(relationshipTone("idea_for_project"), "amber");
});

test("canonical tag chips remain outside semantic status inference", () => {
  assert.equal(inferredStatusMarkerTone("reading", "chip"), undefined);
  assert.equal(inferredStatusMarkerTone("critical", "chip"), undefined);
  assert.equal(inferredStatusMarkerTone("reading", "label"), "blue");
});

test("StatusBadge keeps the semantic fallback off taxonomy chips", async () => {
  const badge = await readFile(new URL("../app/components/StatusBadge.tsx", import.meta.url), "utf8");
  assert.match(badge, /presentation === "chip" \? undefined : "slate"/);
});

test("an unfiltered Library collection patches the saved row without a collection refresh", () => {
  const collection = {
    items: [
      { paper_id: "paper-a", status: "unread", title: "A" },
      { paper_id: "paper-b", status: "reading", title: "B" },
    ],
    total: 2,
  };
  const updated = patchReadingStatusCollection(collection, "paper-a", "reading");

  assert.notStrictEqual(updated, collection);
  assert.equal(updated.items[0].status, "reading");
  assert.strictEqual(updated.items[1], collection.items[1]);
  assert.equal(readingStatusChangeRequiresCollectionRefresh("", "unread", "reading"), false);
});

test("a reading-status filter refreshes only when a saved paper can enter or leave it", () => {
  assert.equal(readingStatusChangeRequiresCollectionRefresh("unread", "unread", "reading"), true);
  assert.equal(readingStatusChangeRequiresCollectionRefresh("reading", "reading", "finished"), true);
  assert.equal(readingStatusChangeRequiresCollectionRefresh("reading", "reading", "reading"), false);
});

test("the inspector and its collection row use the same saved reading state and revision", () => {
  const inspector = patchPaperReadingStatus(
    { paper_id: "paper-a", status: "unread", reading_status_revision: "revision-1" },
    "finished",
    "revision-2",
  );
  const collection = patchReadingStatusCollection({ items: [{ paper_id: "paper-a", status: "unread" }] }, "paper-a", "finished");

  assert.equal(inspector.status, collection.items[0].status);
  assert.equal(inspector.reading_status_revision, "revision-2");
});

test("the inspector leaves visible state unchanged until the server mutation succeeds", async () => {
  const inspector = await readFile(new URL("../app/components/LibraryPaperInspector.tsx", import.meta.url), "utf8");
  const saveStart = inspector.indexOf("const result = await apiClient.saveReadingStatus(");
  const localPatch = inspector.indexOf("resource.updateData((paper) => patchPaperReadingStatus(");
  const failure = inspector.indexOf("} catch (error) {");

  assert.ok(saveStart >= 0);
  assert.ok(localPatch > saveStart);
  assert.ok(failure > localPatch);
  assert.match(inspector, /catch \(error\) \{\n      setStatusMessage/);
  assert.doesNotMatch(inspector, /saveReadingStatus[\s\S]{0,500}resource\.retry\(\)/);
});
