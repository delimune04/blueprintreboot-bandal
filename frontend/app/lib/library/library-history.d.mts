export type LibraryFilters = {searchInput:string;q:string;tag:string;tagInput:string;year:string;readingStatus:string;archiveStatus:'active'|'archived'|'all';offset:number};
export const DEFAULT_LIBRARY_FILTERS: Readonly<LibraryFilters>;
export function normalizeLibraryFilters(value: unknown): LibraryFilters;
export function readLibraryHistory(state: unknown, scope: string): LibraryFilters;
export function mergeLibraryHistory(state: unknown, scope: string, filters: LibraryFilters): Record<string, unknown>;
