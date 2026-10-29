/** Read-only Library query matcher. Preserve each caller's existing search corpus.
 * Whitespace separates required literal substrings; punctuation is not syntax.
 * Normalize copies only: saved metadata, identifiers and notes are never changed.
 */
export function createLibraryQueryMatcher(query = "") {
  const normalize = value => String(value ?? "").normalize("NFKC").toLowerCase();
  const terms = [...new Set(normalize(query).trim().split(/\s+/u).filter(Boolean))];
  if (!terms.length) return () => true;
  return value => {
    const text = normalize(value);
    return terms.every(term => text.includes(term));
  };
}
