import type {OcrProgress} from "./pdf-ocr.mjs";
export interface ExtractedPdfPages { provider:"browser-pdfjs"|"browser-pdfjs+tesseract"; source_pdf_sha256:string; page_count:number; char_count:number; ocr_needed_pages:number[];classification:"scanned"|"mixed"|"text";pages:Array<{page_number:number;text:string}>;ocr_pages:Array<{page_number:number;confidence:number}>;warnings:string[]; }
export function extractPdfPages(file:Blob&{name?:string},options?:{signal?:AbortSignal;maxPages?:number;ocr?:boolean;ocrPageNumbers?:number[];onProgress?:(progress:OcrProgress)=>void}):Promise<ExtractedPdfPages>;
export function formatPdfTextItems(items:unknown[]):string;
export function extractedPagesContent(pages:Array<{page_number:number;text:string}>):string;
