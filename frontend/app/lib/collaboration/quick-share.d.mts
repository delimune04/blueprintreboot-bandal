export interface QuickIdeaSource { type: "paper" | "project" | "page"; id: string; title: string; excerpt?: string }
export interface QuickIdeaDraft { request_id: string; idea: { title: string; body: string; recipient_ids: string[]; source: Required<QuickIdeaSource> } }
export function createQuickIdeaDraft(source: QuickIdeaSource, requestId: string, locale?: "ko" | "en"): QuickIdeaDraft;
export function sendQuickIdeaDraft(draft: QuickIdeaDraft, options: { request: (path: string, init?: {method: "POST";body: object}) => Promise<unknown>; scope: string; getScope: () => string }): Promise<{result_id:string;[key:string]:unknown}>;
