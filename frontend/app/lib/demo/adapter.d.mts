export const DEMO_STORAGE_KEY: string;
export function isDemoEnabled(): boolean;
export function demoPdfUrl(paperId: string): string;
export function demoRequest(path: string, init?: RequestInit): Promise<Response>;
export function createDemoAdapter(storage?: DemoStorage | (() => DemoStorage | Promise<DemoStorage>)): (path: string, init?: RequestInit) => Promise<Response>;
export function createDemoSeed(): unknown;
import type { BrowserPdfRecord } from "./browser-storage.mjs";
export interface DemoStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): unknown | Promise<unknown>;
  compareAndSet?(key: string, expected: string | null, next: string, effects: {putFiles?: BrowserPdfRecord[];deleteFiles?: string[]}): Promise<boolean>;
}
