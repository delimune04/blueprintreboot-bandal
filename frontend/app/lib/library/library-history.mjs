const KEY = 'labvium.library.v1';
export const DEFAULT_LIBRARY_FILTERS = Object.freeze({searchInput:'',q:'',tag:'',tagInput:'',year:'',readingStatus:'',archiveStatus:'active',offset:0});
export function normalizeLibraryFilters(value) {
  const source = value && typeof value === 'object' ? value : {};
  const text = key => typeof source[key] === 'string' ? source[key].slice(0, 500) : '';
  return {searchInput:text('searchInput'), q:text('q'), tag:text('tag'), tagInput:text('tagInput'), year:text('year'),
    readingStatus:['unread','reading','read','finished'].includes(source.readingStatus) ? source.readingStatus : '',
    archiveStatus:['active','archived','all'].includes(source.archiveStatus) ? source.archiveStatus : 'active',
    offset:Number.isSafeInteger(source.offset) && source.offset >= 0 ? Math.floor(source.offset / 20) * 20 : 0};
}
export function readLibraryHistory(state, scope) {
  const entry = state?.[KEY];
  return entry?.scope === scope ? normalizeLibraryFilters(entry.filters) : {...DEFAULT_LIBRARY_FILTERS};
}
export function mergeLibraryHistory(state, scope, filters) {
  return {...(state && typeof state === 'object' && !Array.isArray(state) ? state : {}), [KEY]:{scope, filters:normalizeLibraryFilters(filters)}};
}
