import { fail, id, now, metadata, canonicalNote, METADATA_LIMITS, paperById, hasPdf, sha256, safeId, text, strict, guard } from "./core.mjs";

export function managedPath(value) { const path = text(value, 240, true).replaceAll("\\", "/"); if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").some(part => ["", ".", ".."].includes(part)) || !/\.pdf$/i.test(path)) fail(422, "Only safe managed-relative PDF paths are supported."); return path; }
export function scanFiles(state) {
  return Object.entries(state.files).sort(([a],[b]) => a.localeCompare(b)).map(([relative_path, file]) => {
    const indexed = state.papers.find(paper => paper.pdfPath === relative_path && !paper.pdfMissing);
    const matches = state.papers.filter(paper => paper.pdfSha256 === file.sha256);
    const missing = matches.filter(paper => !hasPdf(paper, state));
    const status = indexed ? "already_registered" : matches.length === 1 && missing.length === 1 ? "reconnect_available" : missing.length ? "reconnect_ambiguous" : matches.length ? "duplicate_content" : "new";
    return { relative_path, filename: relative_path.split("/").at(-1), size_bytes: file.size_bytes, status, can_import: status === "new", can_reconnect: status === "reconnect_available", reconnect_paper_id: status === "reconnect_available" ? missing[0].paper_id : "", message: status === "new" ? "Ready to import." : status === "reconnect_available" ? "Exact content matches one missing Paper; explicitly reconnect it." : "Review the managed PDF state." };
  });
}
export async function importPaths(state, paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 100) fail(422, "Select between one and 100 managed PDFs.");
  const results = [];
  for (const selected of [...new Set(paths)]) {
    const path = managedPath(selected), candidate = scanFiles(state).find(file => file.relative_path === path);
    if (!candidate) { results.push({ relative_path: path, filename: path.split("/").at(-1), size_bytes: 0, status: "missing", can_import: false, paper_id: "", message: "The managed PDF is unavailable." }); continue; }
    if (!candidate.can_import) { results.push({ ...candidate, paper_id: "", can_import: false }); continue; }
    const stem = path.split("/").at(-1).replace(/\.pdf$/i, ""), slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,70) || "paper";
    const identity = id("paper-");
    if (state.papers.some(paper => paper.paper_id === identity)) fail(409, "The managed PDF identity already exists.");
    const paper = { paper_id: identity, metadata: Object.fromEntries(Object.keys(METADATA_LIMITS).map(key => [key,key === "title" ? stem : ""])), tags: [], status: "unread", priority: "normal", archived: false, metadataRev:1, tagsRev:1, statusRev:1, priorityRev:1, lifecycleRev:1, blocksRev:1, pdfRev:1, candidatesRev:1, pdfPath:path, pdfSha256:state.files[path].sha256, pdfMissing:false, note:"", noteExists:false, blocks:[], fullText:"", created_at:now(), updated_at:now() };
    state.papers.push(paper); results.push({ ...candidate, status:"imported",can_import:false,paper_id:identity,message:"Registered a new Paper. Enrichment and extraction remain explicit." });
  }
  const imported_count = results.filter(result => result.status === "imported").length;
  return { results,imported_count,message:`Registered ${imported_count} new Paper(s).` };
}
export function reconnect(state, body) {
  strict(body,["paper_id","relative_path"]);
  const paper=paperById(state,safeId(body.paper_id)), path=managedPath(body.relative_path);
  const candidate=scanFiles(state).find(file=>file.relative_path===path);
  if (!candidate || candidate.status!=="reconnect_available" || candidate.reconnect_paper_id!==paper.paper_id) fail(409,"The exact-content reconnect candidate changed.");
  paper.pdfPath=path;paper.pdfMissing=false;paper.pdfRev=(paper.pdfRev||1)+1;paper.updated_at=now();
  return {status:"reconnected",paper_id:paper.paper_id,relative_path:path,message:"Reconnected the existing Paper; notes and identity were preserved."};
}
export async function stageUploads(state, files, ctx) {
  if (!Array.isArray(files) || !files.length || files.length>100) fail(422,"Upload between one and 100 PDFs.");
  const immediate=[], staged=[];
  for (const file of files) {
    const name=String(file.name||"").replaceAll("\\","/").split("/").at(-1);
    if (!name || !/\.pdf$/i.test(name) || file.size<1 || file.size>25*1024*1024 || name.length>220) { immediate.push({relative_path:"",filename:name||"Unnamed upload",status:"invalid",message:"Hosted PDFs must be at most 25 MiB. Larger PDFs remain supported by the local app.",can_import:false,size_bytes:file.size||0,paper_id:""});continue; }
    const bytes=new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder("latin1").decode(bytes.slice(0,4096)).includes("%PDF-")) { immediate.push({relative_path:"",filename:name,status:"invalid",message:"The file has no PDF header.",can_import:false,size_bytes:bytes.length,paper_id:""});continue; }
    const hash=await sha256(bytes), existing=state.papers.find(paper=>paper.pdfSha256===hash&&hasPdf(paper,state));
    if(existing){immediate.push({relative_path:existing.pdfPath,filename:name,status:"duplicate_content",message:"Exact PDF content is already registered.",can_import:false,size_bytes:bytes.length,paper_id:existing.paper_id});continue;}
    let path=name,index=2;while(state.files[path])path=`${name.replace(/\.pdf$/i,"")} (${index++}).pdf`;
    const stored=await ctx.putObject("pdfs",bytes,{contentType:"application/pdf"});
    state.files[path]={...stored,filename:path};staged.push(path);
  }
  const imported=staged.length?await importPaths(state,staged):{results:[],imported_count:0};
  return {message:`Processed ${files.length} uploaded PDF(s).`,imported_count:imported.imported_count,results:[...immediate,...imported.results]};
}
export function saveExtraction(paper,state,body) {
  strict(body,["force","source_pdf_sha256","pages","provider","provider_version","classification","expected_pdf_revision","ocr_pages"]);
  if(body.expected_pdf_revision!==undefined)guard(body.expected_pdf_revision,paper.pdfRev||1);
  if(!hasPdf(paper,state))fail(409,"A managed PDF is required for extraction.");
  if(!Array.isArray(body.pages))fail(422,"Extract this PDF with browser PDF.js and submit page evidence.","extraction_requires_client");
  if(body.source_pdf_sha256!==state.files[paper.pdfPath].sha256)fail(409,"The PDF changed before extracted text could be saved.");
  if(!["browser-pdfjs","browser-pdfjs+tesseract"].includes(body.provider))fail(422,"Only explicit browser PDF.js or PDF.js with Tesseract extraction is supported by this hosted runtime.");
  if(body.force!==undefined&&typeof body.force!=="boolean")fail(422,"Force must be a boolean.");
  if(body.pages.length<1||body.pages.length>10000)fail(422,"Invalid extracted page count.");
  let total=0;const seen=new Set();const pages=body.pages.map(value=>{strict(value,["page_number","text"]);if(!Number.isInteger(value.page_number)||value.page_number<1||value.page_number>10000||seen.has(value.page_number))fail(422,"Invalid or duplicate page evidence.");seen.add(value.page_number);const content=text(value.text,200000);total+=content.length;if(total>2000000)fail(413,"Extracted text exceeds this workspace's page-evidence limit.");return{page_number:value.page_number,text:content};}).sort((a,b)=>a.page_number-b.page_number);
  if(pages.some((p,index)=>p.page_number!==index+1))fail(422,"Submit contiguous page evidence starting at page one.");
  const ocr_pages=body.ocr_pages||[];if(!Array.isArray(ocr_pages)||ocr_pages.length>20)fail(422,"OCR evidence must be a bounded list of at most 20 pages.");const ocrSeen=new Set();for(const evidence of ocr_pages){strict(evidence,["page_number","confidence"]);if(!Number.isInteger(evidence.page_number)||evidence.page_number<1||evidence.page_number>pages.length||ocrSeen.has(evidence.page_number)||!Number.isFinite(evidence.confidence)||evidence.confidence<0||evidence.confidence>100)fail(422,"Invalid OCR evidence.");ocrSeen.add(evidence.page_number);}if(ocr_pages.length&&body.provider!=="browser-pdfjs+tesseract")fail(422,"OCR page evidence requires the actual Tesseract provider.");
  paper.fullTextCache={sha256:body.source_pdf_sha256,provider:body.provider,provider_version:text(body.provider_version||"",100),classification:pages.every(page=>!page.text.trim())?"scanned":pages.some(page=>!page.text.trim())?"mixed":"text",pages,ocr_pages,content:pages.map(page=>page.text).join("\n\n"),extracted_at:now()};
  return paper.fullTextCache;
}
