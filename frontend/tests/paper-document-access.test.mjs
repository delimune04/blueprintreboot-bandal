import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url);
class ApiClientError extends Error { constructor(message,kind,status){super(message);this.kind=kind;this.status=status;} }
const paper={paper_id:'paper-a',title:'Saved paper',missing_pdf:true,metadata_only:true,relative_pdf_path:'',pdf_revision:'0001',external_source:{pdf_url:'https://arxiv.org/pdf/1706.03762',url:'https://arxiv.org/abs/1706.03762'}};
function surface({role='owner',request=async()=>({}),hooks=React}={}) {
  const output=ts.transpileModule(readFileSync(new URL('../app/components/PaperDocumentAccess.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  function localRequire(name){
    if(name.endsWith('.css')) return {};
    if(name==='react')return hooks;
    if(name==='next/link')return {default:({children,...props})=>React.createElement('a',props,children)};
    if(name.endsWith('/api/client'))return {ApiClientError,getWorkspaceMode:()=> 'cloud',getWorkspaceRole:()=>role,labviumRequest:request};
    if(name.endsWith('/i18n/LocaleProvider'))return {useI18n:()=>({locale:'ko'})};
    if(name.endsWith('/workspace/pages.mjs'))return require('../app/lib/workspace/pages.mjs');
    if(name==='./Section')return {Section:({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children)};
    return require(name);
  }
  new Function('require','module','exports',output)(localRequire,module,module.exports);return module.exports.PaperDocumentAccess;
}
function treeNodes(tree,predicate){const results=[];function walk(node){if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;if(predicate(node))results.push(node);walk(node.props?.children);}walk(tree);return results;}
function harness(request,role='owner'){
  const states=[];const cleanup=[];let i=0;let refreshed=0;
  const hooks={...React,useRef(initial){const key=i++;if(!(key in states))states[key]={current:initial};return states[key];},useState(initial){const key=i++;if(!(key in states))states[key]=initial;return [states[key],value=>states[key]=typeof value==='function'?value(states[key]):value];},useEffect(fn){const key=i++;if(!(key in states)){states[key]=true;cleanup.push(fn());}}};
  const View=surface({request,role,hooks});return {render(){i=0;return View({paper,onAttached(){refreshed++;}});},unmount(){cleanup.forEach(fn=>fn?.());},refreshed:()=>refreshed};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('intentional metadata-only and genuinely missing PDFs have different reading guidance',()=>{
  const View=surface();const html=renderToStaticMarkup(React.createElement(View,{paper,onAttached(){}}));assert.match(html,/서지정보·초록 저장됨/);assert.match(html,/공개 PDF 가져오기/);assert.match(html,/内|내 PDF 연결/);
  const lost=renderToStaticMarkup(React.createElement(View,{paper:{...paper,metadata_only:false,relative_pdf_path:'papers/old.pdf'},onAttached(){}}));assert.match(lost,/이전에 연결한 PDF를 찾을 수 없음/);assert.match(lost,/같은 원본 PDF/);assert.ok(!lost.includes('검색에서 저장한 논문은'));
});
test('public PDF import addresses the same library Paper and forwards its revision',async()=>{
  const calls=[];const h=harness(async(path,options)=>{calls.push({path,options});return {status:'attached'};});let tree=h.render();treeNodes(tree,node=>node.type==='button')[0].props.onClick();await settle();assert.equal(calls.length,1);assert.equal(calls[0].path,'/papers/paper-a/import-source-pdf');assert.equal(calls[0].options.body.expected_pdf_revision,'0001');assert.equal(h.refreshed(),1);h.unmount();
});
test('conflict preserves server explanation and exposes refresh instead of implying download failure',async()=>{
  const h=harness(async()=>{throw new ApiClientError('PDF changed in another session','conflict',409);});let tree=h.render();treeNodes(tree,node=>node.type==='button')[0].props.onClick();await settle();tree=h.render();const html=renderToStaticMarkup(tree);assert.match(html,/PDF changed in another session/);assert.match(html,/최신 상태 확인/);assert.ok(!html.includes('접근 제한 등으로'));h.unmount();
});
test('viewer cannot import and late completion after unmount cannot refresh another paper',async()=>{
  let resolve;const h=harness(()=>new Promise(done=>resolve=done));const tree=h.render();treeNodes(tree,node=>node.type==='button')[0].props.onClick();h.unmount();resolve({status:'attached'});await settle();assert.equal(h.refreshed(),0);
  let calls=0;const viewer=harness(async()=>{calls++;},'viewer');const readonly=viewer.render();const button=treeNodes(readonly,node=>node.type==='button')[0];assert.equal(button.props.disabled,true);button.props.onClick();await settle();assert.equal(calls,0);viewer.unmount();
});
