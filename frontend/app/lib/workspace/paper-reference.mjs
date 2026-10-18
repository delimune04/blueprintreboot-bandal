// A transparent, plain-text reference from retained metadata. This is not an APA formatter.
function clean(value) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
}

export function paperReference(paper = {}, locale = "en") {
  const ko = locale === "ko";
  const authors = Array.isArray(paper.authors) ? paper.authors.map(clean).filter(Boolean) : [];
  const title = clean(paper.title);
  const year = clean(paper.year);
  const journal = clean(paper.journal);
  const doi = clean(paper.doi);
  const arxiv = clean(paper.arxiv_id);
  const missing = [];
  if (!title) missing.push(ko ? "제목" : "title");
  if (!authors.length) missing.push(ko ? "저자" : "authors");
  if (!year) missing.push(ko ? "연도" : "year");
  // Preserve author order and identifier strings. Do not infer initials, publication type or dates.
  const lines = [
    `${ko ? "제목" : "Title"}: ${title || (ko ? "미등록" : "Not recorded")}`,
    `${ko ? "저자" : "Authors"}: ${authors.length ? authors.join("; ") : (ko ? "미등록" : "Not recorded")}`,
    `${ko ? "연도" : "Year"}: ${year || (ko ? "미등록" : "Not recorded")}`,
  ];
  if (journal) lines.push(`${ko ? "학술지" : "Journal"}: ${journal}`);
  if (doi) lines.push(`DOI: ${doi}`);
  if (arxiv) lines.push(`arXiv: ${arxiv}`);
  return { text: lines.join("\n"), missing };
}

// Called only from a user click; no deprecated copy command or silent success fallback.
export async function copyPaperReference(text, clipboard) {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;
  try { await clipboard.writeText(text); return true; } catch { return false; }
}
