export function searchFullText(content, query, limit = 1000) {
  const text = String(content);
  const needle = String(query).trim();
  if (!needle) return [];
  const matches = [];
  // Match original code-point offsets. Lowercasing the whole document can
  // change its length for some Unicode letters and corrupt highlight ranges.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "giu");
  const boundaries = [...text.matchAll(/(?:^|\n)--- Page (\d+) ---/g)].map((match) => ({ index: match.index, page: Number(match[1]) }));
  const formFeeds = [...text.matchAll(/\f/g)].map((match) => match.index);
  let boundaryIndex = -1;
  let formFeedIndex = -1;
  while (matches.length < limit) {
    const match = pattern.exec(text);
    if (!match) break;
    const index = match.index;
    while (boundaries[boundaryIndex + 1]?.index <= index) boundaryIndex += 1;
    while (formFeeds[formFeedIndex + 1] < index) formFeedIndex += 1;
    const page = boundaries[boundaryIndex]?.page || (formFeeds.length ? formFeedIndex + 2 : null);
    matches.push({ index, length: match[0].length, page, excerpt: text.slice(Math.max(0, index - 70), Math.min(text.length, index + match[0].length + 110)).replace(/\s+/g, " ") });
  }
  return matches;
}

export function highlightedTextSegments(content, matches) {
  const result = [];
  let position = 0;
  for (const match of matches) {
    if (match.index > position) result.push({ text: content.slice(position, match.index), match: null });
    result.push({ text: content.slice(match.index, match.index + match.length), match });
    position = match.index + match.length;
  }
  if (position < content.length) result.push({ text: content.slice(position), match: null });
  return result;
}
