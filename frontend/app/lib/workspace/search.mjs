// Literal, case-insensitive retrieval of saved evidence; no semantic/AI claim.
export function searchWorkspace(state, researchPages, query, projectId = "", limit = 100) {
  const needle = String(query || "").normalize("NFKC").toLocaleLowerCase().trim();
  if (!needle || needle.length > 500) return [];
  const selectedProject = projectId ? state.projects?.find((project) => project.project_id === projectId) : null;
  const paperIds = selectedProject ? new Set(selectedProject.links.map((link) => link.paper_id)) : null;
  const results = [];
  const match = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().indexOf(needle);
  function append(row, content) {
    if (results.length >= limit) return;
    const index = match(content);
    if (index < 0) return;
    const text = String(content || "");
    results.push({ ...row, snippet: `${index > 90 ? "…" : ""}${text.slice(Math.max(0, index - 90), index + needle.length + 160)}${text.length > index + needle.length + 160 ? "…" : ""}` });
  }
  const tagLabels = new Map((state.tags || []).map((tag) => [tag.canonical_key, tag.label]));
  for (const paper of state.papers || []) {
    if (paperIds && !paperIds.has(paper.paper_id)) continue;
    const title = paper.metadata?.title || paper.title || paper.paper_id;
    const base = { paper_id: paper.paper_id, title, url: `/papers/${encodeURIComponent(paper.paper_id)}/reader` };
    append({ ...base, id: `metadata:${paper.paper_id}`, kind: "paper" }, Object.values(paper.metadata || {}).join(" ") + " " + (paper.tags || []).map((tag) => tagLabels.get(tag) || tag).join(" "));
    append({ ...base, id: `note:${paper.paper_id}`, kind: "reading-note" }, paper.note);
    for (const block of paper.blocks || []) append({ ...base, id: `block:${block.id}`, kind: "note-block", block_id: block.id,
      page: /^\d+$/.test(String(block.page)) ? Number(block.page) : null,
      url: `${base.url}?noteBlock=${encodeURIComponent(block.id)}`,
    }, [block.title, block.text, block.quote, ...(block.tags || [])].join(" "));
    const pages = paper.fullTextCache?.pages || paper.extraction?.pages || paper.fullTextPages || paper.pages || [];
    if (pages.length) {
      for (const page of pages) { const number = page.page_number || page.page;
        append({ ...base, id: `page:${paper.paper_id}:${number}`, kind: "pdf-page", page: number, url: `${base.url}?page=${number}` }, page.text); }
    } else if (paper.fullText) append({ ...base, id: `fulltext:${paper.paper_id}`, kind: "full-text" }, paper.fullText);
  }
  for (const project of state.projects || []) {
    if (projectId && project.project_id !== projectId) continue;
    append({ id: `project:${project.project_id}`, kind: "project", title: project.name, project_id: project.project_id, url: `/projects/${encodeURIComponent(project.project_id)}` }, [project.name, project.description, ...(project.tags || [])].join(" "));
  }
  for (const page of researchPages || []) {
    if (projectId && page.project_id !== projectId) continue;
    append({ id: `research:${page.id}`, kind: "research-page", title: page.title, research_page_id: page.id, project_id: page.project_id, url: `/workspace?page=${encodeURIComponent(page.id)}` }, [page.title, ...(page.blocks || []).map((block) => block.text), ...Object.values(page.handoff || {})].join(" "));
  }
  return results;
}
