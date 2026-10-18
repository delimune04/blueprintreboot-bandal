import assert from "node:assert/strict";
import test from "node:test";
import { isMetadataOnlyPaper } from "../app/lib/library/paper-file-state.mjs";

test("discovery records awaiting their first PDF are distinct from missing attachments", () => {
  assert.equal(isMetadataOnlyPaper({ metadata_only: true, missing_pdf: true }), true);
  assert.equal(isMetadataOnlyPaper({ metadata_only: false, missing_pdf: true }), false);
  assert.equal(isMetadataOnlyPaper({ missing_pdf: true }), false);
  assert.equal(isMetadataOnlyPaper({ external_source: { id: "work-1" }, missing_pdf: true }), false);
  assert.equal(isMetadataOnlyPaper({ metadata_only: true, missing_pdf: false }), false);
  assert.equal(isMetadataOnlyPaper(null), false);
});
