import type { ProjectListItem } from "../api/types";
export function filterProjectCollection<T extends ProjectListItem>(projects: readonly T[], query?: string, status?: string, priority?: string): T[];
