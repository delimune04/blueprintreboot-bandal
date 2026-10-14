import type { ResearchBlock, ResearchPage, ResearchPageInput, ResearchPages, ResearchPageResponse } from './types';
export const RESEARCH_PAGES_KEY: string;
export function safeResearchUrl(value: unknown): string;
export function validateResearchPageInput(value: unknown): ResearchPageInput;
export function validateResearchPagesState(value: unknown): { version: 1; sequence: number; pages: ResearchPage[] };
export function blankResearchPage(parentId?: string | null): ResearchPageInput;
export function newResearchBlock(type?: ResearchBlock['type']): ResearchBlock;
export function researchPageInput(page: ResearchPage): ResearchPageInput;
export function flattenResearchPageTree(pages: ResearchPage[], showArchived?: boolean): Array<{page: ResearchPage; depth: number}>;
export function createResearchPagesStore(storage?: Storage | (() => Storage)): {
  list(): ResearchPages; export(): {version:1;sequence:number;pages:ResearchPage[]};
  create(input: ResearchPageInput): ResearchPageResponse;
  save(id:string,input:ResearchPageInput,expected:string):ResearchPageResponse;
  archive(id:string,archived:boolean,expected:string,confirm:boolean):ResearchPageResponse;
  restore(archive:unknown,expected:string,confirm:boolean):{status:'restored';revision:string};
};
