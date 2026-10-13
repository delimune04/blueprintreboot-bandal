export const DEMO_STORAGE_KEY: string;
export function isDemoEnabled(): boolean;
export function demoPdfUrl(paperId: string): string;
export function demoRequest(path: string, init?: RequestInit): Promise<Response>;
export function createDemoAdapter(storage?: Storage | (() => Storage)): (path: string, init?: RequestInit) => Promise<Response>;
export function createDemoSeed(): unknown;
