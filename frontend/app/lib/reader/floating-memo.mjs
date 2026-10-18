import { selectionProvenance, validateReaderSelection } from "./browser-reader-state.mjs";

// Position lives beside memo text in the existing revision-checked Note Block.
// The suffix is deliberately versioned; malformed/unknown suffixes remain text.
const SUFFIX = /\n\n<!-- labvium-floating-memo:v1 (\{"x":[0-9.]+,"y":[0-9.]+\}) -->$/;
export const DEFAULT_MEMO_POSITION = { x: 0.65, y: 0.45 };

export function clampMemoPosition(position = DEFAULT_MEMO_POSITION) {
  return Object.fromEntries(["x", "y"].map((key) => [key, Number(Math.max(0, Math.min(1, Number.isFinite(position[key]) ? position[key] : DEFAULT_MEMO_POSITION[key])).toFixed(5))]));
}

export function encodeFloatingMemo(text, position) {
  return `${String(text)}\n\n<!-- labvium-floating-memo:v1 ${JSON.stringify(clampMemoPosition(position))} -->`;
}

export function decodeFloatingMemo(content) {
  const text = String(content ?? "");
  const match = text.match(SUFFIX);
  if (!match) return null;
  try {
    const position = JSON.parse(match[1]);
    if (![position.x, position.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
    return { text: text.slice(0, match.index), position };
  } catch { return null; }
}

export function floatingMemoDraft(selection = null) {
  return {
    block_type: "idea", title: "", text: encodeFloatingMemo("", DEFAULT_MEMO_POSITION),
    page: selection ? String(selection.pageNumber) : "", figure: "", quote: selection?.text ?? "", tags: [],
    ...(selection ? { provenance: selectionProvenance(selection) } : {}),
  };
}

export function citedBlockHighlights(blocks, paperId) {
  return blocks.flatMap((block) => {
    if (block.paper_id !== paperId || block.provenance?.source !== "pdf_selection") return [];
    const source = block.provenance;
    const selection = { pageNumber: source.page, coordinateSpace: source.coordinate_space, text: source.quote, rectangles: source.rectangles };
    return validateReaderSelection(selection) ? [{ ...selection, id: `block:${block.id}` }] : [];
  });
}

export function mergeReaderHighlights(local, cited) {
  const signature = (highlight) => JSON.stringify(selectionProvenance(highlight));
  const persisted = new Set(cited.map(signature));
  return [...local.filter((highlight) => !persisted.has(signature(highlight))), ...cited];
}
