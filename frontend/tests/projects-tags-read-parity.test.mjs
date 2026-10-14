import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

const sources = Promise.all([
  readFile(new URL("../app/projects/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tags/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ProjectDetailView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/AsyncStates.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/hooks/useApiResource.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
]);

test("Projects and Tags routes no longer render deferred placeholders", async () => {
  const [projectsPage, projectDetailPage, tagsPage, projects, projectDetail, tags] = await sources;

  assert.match(projectsPage, /<ProjectsView \/>/);
  assert.match(projectDetailPage, /<ProjectDetailView projectId=\{projectId\} \/>/);
  assert.match(tagsPage, /<TagsView \/>/);
  for (const source of [projectsPage, projectDetailPage, tagsPage, projects, projectDetail, tags]) {
    assert.doesNotMatch(source, /DeferredWorkspaceView/);
  }
});

test("Projects renders browsable collection fields and complete typed-link detail", async () => {
  const [, , , projects, projectDetail, , , , client] = await sources;

  assert.match(projects, /apiClient\.getAllProjects/);
  assert.match(projects, /Project collection filters/);
  assert.match(projects, /Recently updated/);
  assert.match(projects, />Next<\/button>/);
  for (const field of ["project.name", "project.project_id", "project.status", "project.priority", "project.tags", "project.linked_paper_count", "project.linked_note_block_count", "project.updated_at"]) {
    assert.match(projects, new RegExp(field.replace(".", "\\.")));
  }
  assert.match(projectDetail, /apiClient\.getCompleteProject\(projectId\)/);
  assert.match(projectDetail, /link\.link_type/);
  assert.match(projectDetail, /link\.target_state/);
  assert.match(projectDetail, /link\.paper\.title/);
  assert.match(projectDetail, /link\.paper_id/);
  assert.match(projectDetail, /Linked Paper unavailable/);
  assert.match(projectDetail, /Linked Note Blocks/);
  assert.match(projectDetail, /project\.linked_note_block_count/);
  assert.match(client, /links_limit/);
  assert.match(client, /links_offset/);
  assert.match(projects, /Create Project/);
  assert.match(projectDetail, /Edit Project/);
  assert.match(projectDetail, /Archive Project/);
  assert.match(projectDetail, /Manage links/);
  assert.match(projectDetail, /project-material-row/);
  assert.doesNotMatch(projects + projectDetail, /Delete Project/);
});

test("Tags renders canonical identity, label, category, aliases, status, and real summary counts", async () => {
  const [, , , , , tags, , , client] = await sources;

  assert.doesNotMatch(tags, /apiClient\.getAllTags\(\)/);
  assert.match(tags, /apiClient\.getTagSummary\(\)/);
  assert.match(tags, /apiClient\.getTagReviewQueue\(\)/);
  assert.match(tags, /apiClient\.getTagGovernance\(\)/);
  for (const field of ["tag.label", "tag.canonical_key", "tag.category", "tag.aliases", "selected.status", "selected.suggestion_strength"]) {
    assert.match(tags, new RegExp(field.replace(".", "\\.")));
  }
  assert.match(tags, /summary\.candidate_count/);
  assert.match(tags, /summary\.quality_counts\.high/);
  assert.match(tags, /Candidate summary unavailable/);
  assert.match(tags, /No candidate evidence/);
  assert.match(client, /\/tags\/summary/);
  for (const operation of ["createCanonicalTag", "updateCanonicalTag", "addCanonicalTagAlias", "removeCanonicalTagAlias", "deprecateCanonicalTag"]) {
    assert.match(tags, new RegExp(`apiClient\\.${operation}`));
  }
});

test("shared async states cover loading, empty, offline, read-model failure, not-found, and retry", async () => {
  const [, , , projects, projectDetail, tags, asyncStates, resourceHook] = await sources;

  for (const source of [projects, projectDetail, tags]) {
    assert.match(source, /status === "loading"/);
    assert.match(source, /status === "unavailable"/);
    assert.match(source, /status === "error"/);
    assert.match(source, /onRetry=\{resource\.retry\}/);
    assert.match(source, /<EmptyState/);
  }
  assert.match(projectDetail, /status === "not-found"/);
  assert.match(asyncStates, />Retry<\/button>/);
  assert.match(resourceHook, /setAttempt\(\(current\) => current \+ 1\)/);
  assert.match(resourceHook, /resourceKey !== activeResourceKey/);
});

test("read parity contains no fabricated records and preserves existing views", async () => {
  const [, , , projects, projectDetail, tags] = await sources;
  const [library, papers, reader] = await Promise.all([
    readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/PapersView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(projects, /apiClient\.getAllProjects/);
  assert.match(tags, /apiClient\.getTagGovernance/);
  assert.doesNotMatch(projects + projectDetail + tags, /const\s+(?:projects|tags|papers)\s*=\s*\[/i);
  assert.match(library, /apiClient\.getLibraryStatus/);
  assert.match(library, /apiClient\.getPapers/);
  assert.match(papers, /Library is the primary Paper collection surface/);
  assert.match(reader, /apiClient\.getReaderSnapshot/);
  for (const operation of ["generateTagCandidates", "applyTagCandidate"]) {
    assert.match(reader, new RegExp(`apiClient\\.${operation}`));
  }
  assert.match(reader, /Nothing has been applied to this Paper/);
  assert.match(reader, /Apply selected/);
  for (const operation of ["approveTagCandidate", "rejectTagCandidate", "promoteTagCandidate"]) {
    assert.match(reader, new RegExp(`apiClient\\.${operation}`));
  }
  assert.match(reader, /They are not LLM output/);
  assert.doesNotMatch(reader, /candidate\.confidence|candidate\.score/);
});
