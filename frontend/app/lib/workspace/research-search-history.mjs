const KEY = 'labvium.research-search.v1';
export function normalizeResearchSearchQuery(value) {
  return typeof value === 'string' ? value.slice(0, 500) : '';
}
export function readResearchSearchHistory(state, scope) {
  const entry = state?.[KEY];
  return entry?.scope === scope ? normalizeResearchSearchQuery(entry.query) : '';
}
export function mergeResearchSearchHistory(state, scope, query) {
  return {...(state && typeof state === 'object' && !Array.isArray(state) ? state : {}),
    [KEY]: {scope, query: normalizeResearchSearchQuery(query)}};
}
