import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url);
class ApiClientError extends Error { constructor(message,kind,status){super(message);this.kind=kind;this.status=status;} }
const paper={paper_id:'paper-a',title:'Saved paper',missing_pdf:true,metadata_only:true,relative_pdf_path:'',pdf_revision:'0001',external_source:{arxiv_id:'1706.03762',url:'https://arxiv.org/abs/1706.03762',pdf_url:''}};
const openAccess={status:'open_access',pdf_url:'https://arxiv.org/pdf/1706.03762',source_url:'https://arxiv.org/abs/1706.03762',can_import:true,reason:'arxiv'};
function surface({role='owner',request=async()=>openAccess,hooks=React,router={replace(){}},download=async()=>{}}={}) {
  const output=ts.transpileModule(readFileSync(new URL('../app/components/PaperDocumentAccess.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  function localRequire(name){
    if(name.endsWith('.css'))return {};
    if(name==='react')return hooks;
    if(name==='next/link')return {default:({children,...props})=>React.createElement('a',props,children)};
    if(name==='next/navigation')return {useRouter:()=>router};
    if(name.endsWith('/api/client'))return {ApiClientError,getWorkspaceMode:()=> 'cloud',getWorkspaceRole:()=>role,labviumRequest:request};
    if(name.endsWith('/i18n/LocaleProvider'))return {useI18n:()=>({locale:'ko'})};
    if(name.endsWith('/workspace/pages.mjs'))return require('../app/lib/workspace/pages.mjs');
    if(name.endsWith('/workspace/pdf-access.mjs'))return {...require('../app/lib/workspace/pdf-access.mjs'),downloadManagedPdf:download};
    if(name==='./Section')return {Section:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children)};
    return require(name);
  }
  new Function('require','module','exports',output)(localRequire,loaded,loaded.exports);return loaded.exports.PaperDocumentAccess;
}
function treeNodes(tree,predicate){const results=[];function walk(node){if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;if(predicate(node))results.push(node);walk(node.props?.children);}walk(tree);return results;}
function button(tree,text){return treeNodes(tree,node=>node.type==='button'&&JSON.stringify(node.props.children).includes(text))[0];}
function harness({request=async()=>({status:'attached'}),role='owner',access=openAccess,inputPaper=paper,autoAction=null,download=async()=>{}}={}){
  const states=[];const effects=[];const queued=[];const routes=[];const calls=[];let i=0;let refreshed=0;
  const hooks={...React,useRef(initial){const key=i++;if(!(key in states))states[key]={current:initial};return states[key];},useState(initial){const key=i++;if(!(key in states))states[key]=typeof initial==='function'?initial():initial;return [states[key],value=>states[key]=typeof value==='function'?value(states[key]):value];},useEffect(fn,deps){const key=i++;const old=effects[key];if(!old||deps?.some((value,index)=>!Object.is(value,old.deps?.[index]))){queued.push(()=>{old?.cleanup?.();effects[key]={deps,cleanup:fn()};});}}};
  const View=surface({request:(path,options)=>{calls.push({path,options});return path.endsWith('/pdf-access')?Promise.resolve(access):request(path,options);},role,hooks,router:{replace:path=>routes.push(path)},download});
  return {calls,routes,render(){i=0;const tree=View({paper:inputPaper,autoAction,onAttached(){refreshed++;}});queued.splice(0).forEach(fn=>fn());return tree;},unmount(){effects.forEach(effect=>effect?.cleanup?.());},refreshed:()=>refreshed};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('PDF controls offer web reader and download; no compulsory manual file prompt',async()=>{
  const h=harness();h.render();await settle();const tree=h.render();const html=renderToStaticMarkup(tree);assert.match(html,/웹에서 PDF 읽기/);assert.match(html,/PDF 다운로드/);assert.match(html,/원문 PDF를 찾았습니다/);assert.match(html,/PDF 파일을 이미 가지고 있나요/);assert.equal(button(tree,'웹에서 PDF 읽기').props.disabled,false);
  assert.equal(h.calls[0].path,'/papers/paper-a/pdf-access');h.unmount();
});
test('explicit reader navigation resolves missing PDF URL, attaches same Paper once and opens Reader',async()=>{
  let resolve;const h=harness({autoAction:'reader',request:()=>new Promise(done=>resolve=done)});h.render();await settle();h.render();h.render();assert.equal(h.calls.filter(c=>c.path.endsWith('/import-source-pdf')).length,1);const write=h.calls.find(c=>c.path.endsWith('/import-source-pdf'));assert.equal(write.options.body.expected_pdf_revision,'0001');resolve({status:'attached'});await settle();assert.deepEqual(h.routes,['/papers/paper-a/reader']);h.unmount();
});
test('automatic download uses prepared PDF and consumes intent without repeated download',async()=>{
  const downloads=[];const h=harness({autoAction:'download',inputPaper:{...paper,missing_pdf:false,metadata_only:false,relative_pdf_path:'papers/a.pdf'},download:async(...args)=>downloads.push(args)});h.render();await settle();h.render();await settle();h.render();assert.equal(downloads.length,1);assert.equal(downloads[0][0],'paper-a');assert.deepEqual(h.routes,['/papers/paper-a']);assert.equal(h.calls.length,0);h.unmount();
});
test('no open-access PDF retains publisher access and never invents or imports a PDF',async()=>{
  const noPdf={status:'source_only',pdf_url:'',source_url:'https://doi.org/10.5555/unavailable',can_import:false};const h=harness({autoAction:'reader',inputPaper:{...paper,external_source:{doi:'10.5555/unavailable',url:noPdf.source_url}},access:noPdf});h.render();await settle();h.render();const html=renderToStaticMarkup(h.render());assert.match(html,/공개된 PDF 주소를 찾지 못했습니다/);assert.match(html,/https:\/\/doi.org\/10.5555\/unavailable/);assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(h.routes.length,0);h.unmount();
});
test('conflict preserves explanation and refresh path instead of replacing it with publisher failure',async()=>{
  const h=harness({request:async()=>{throw new ApiClientError('PDF changed in another session','conflict',409);}});h.render();await settle();let tree=h.render();button(tree,'웹에서 PDF 읽기').props.onClick();await settle();tree=h.render();const html=renderToStaticMarkup(tree);assert.match(html,/PDF changed in another session/);assert.match(html,/최신 상태 확인/);assert.ok(!html.includes('앱으로 가져오지 못했습니다'));h.unmount();
});
test('viewer can use source link but cannot attach; a late import cannot navigate after unmount',async()=>{
  const viewer=harness({role:'viewer',autoAction:'reader'});viewer.render();await settle();viewer.render();await settle();assert.equal(viewer.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(viewer.routes.length,0);assert.match(renderToStaticMarkup(viewer.render()),/원문 PDF 열기/);viewer.unmount();
  let resolve;const h=harness({autoAction:'reader',request:()=>new Promise(done=>resolve=done)});h.render();await settle();h.render();h.unmount();resolve({status:'attached'});await settle();assert.equal(h.routes.length,0);
});
