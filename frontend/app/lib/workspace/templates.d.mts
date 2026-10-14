import type { ResearchPageInput } from './types';
export const RESEARCH_TEMPLATES: Array<{id:string;label:string}>;
export function createResearchTemplate(id:string,translate?:(value:string)=>string,parentId?:string|null):ResearchPageInput;
