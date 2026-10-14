export const MAX_OCR_PAGES:number;
export interface OcrProgress { phase?:string;status?:string;page?:number;totalPages?:number;total?:number;progress?:number;message?:string; }
export function selectOcrPages(pages:Array<{page_number:number;text:string}>,selected?:number[]):number[];
export function recognizeScannedPdfPages(pdfDocument:unknown,pages:Array<{page_number:number;text:string}>,options?:{signal?:AbortSignal;ocrPageNumbers?:number[];onProgress?:(progress:OcrProgress)=>void}):Promise<{pages:Array<{page_number:number;text:string}>;ocr_pages:Array<{page_number:number;confidence:number}>;warnings:string[]}>;
export function renderPdfPageForOcr(page:unknown,options?:{signal?:AbortSignal}):Promise<HTMLCanvasElement>;
