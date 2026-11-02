import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Set REVIEW_FOCUS_FRONTEND only while running this standalone proposed test.
const root=process.env.REVIEW_FOCUS_FRONTEND || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json'));
const React=require('react'), ts=require('typescript');
const model=require(path.join(root,'app/lib/review/model.mjs'));
const source=fs.readFileSync(path.join(root,'app/views/ProjectReviewView.tsx'),'utf8').replace('function ReviewEditor(', 'export function ReviewEditor(');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function nodes(node,predicate){
 if(Array.isArray(node))return node.flatMap(n=>nodes(n,predicate));
 if(!node||typeof node!=='object')return[];
 return [...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];
}
const component=(tree,name)=>nodes(tree,n=>n.type===name)[0];
const textareas=tree=>nodes(tree,n=>n.type==='textarea');
function fixture({count=0,role='owner',status='active'}={}){
 let cursor=0;const states=[],deps=[],cleanups=[],focus=[];let pending=[];
 const hooks={...React,
  useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},
  useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];},
  useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((v,j)=>!Object.is(v,deps[i][j]))){deps[i]=next;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}},
 };
 const initial={project_id:'focus-project',project_name:'Focus project',project_status:status,revision:'r1',dossier:{...model.blankReviewInput(),rows:Array.from({length:count},()=>model.newReviewRow()),snapshots:[]},sources:[]};
 const requests=[],loaded={exports:{}};
 new Function('require','module','exports',compiled)(name=>{
  if(name==='react')return hooks;
  if(name.endsWith('.css'))return{};
  if(name.endsWith('model.mjs'))return model;
  if(name.endsWith('readiness.mjs'))return require(path.join(root,'app/lib/review/readiness.mjs'));
  if(name.endsWith('focus-new-record.mjs'))return{focusNewReviewRecord:(_document,id)=>focus.push(id)};
  if(name.endsWith('/api/client'))return{getWorkspaceRole:()=>role,labviumRequest:async(...args)=>{requests.push(args);return initial;}};
  if(name.endsWith('LocaleProvider'))return{useI18n:()=>({locale:'en',t:value=>value})};
  if(name.startsWith('../components/'))return new Proxy({},{get:(_object,key)=>key});
  if(name.startsWith('../hooks/'))return{};
  return require(name);
 },loaded,loaded.exports);
 return{focus,requests,render(){cursor=0;pending=[];const tree=loaded.exports.ReviewEditor({initial});const effects=pending;pending=[];effects.forEach(fn=>fn());return tree;},unmount(){cleanups.forEach(fn=>fn?.());}};
}
async function browser(run){
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 globalThis.window={addEventListener(){},removeEventListener(){},confirm:()=>true};
 globalThis.document={addEventListener(){},removeEventListener(){}};
 try{await run();}finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
}
test('explicit workflow, derived and ordinary additions focus once without changing prior text or evidence',()=>browser(()=>{
 const h=fixture();let tree=h.render();assert.deepEqual(h.focus,[]);
 const first=model.newWorkflowRow('comparison');component(tree,'ReviewWorkflow').props.add(first);tree=h.render();assert.deepEqual(h.focus,[first.id]);tree=h.render();assert.equal(h.focus.length,1);
 textareas(tree)[0].props.onChange({target:{value:'Original comparison'}});tree=h.render();assert.equal(h.focus.length,1);
 const derived={...model.newWorkflowRow('decision'),text:'Review this decision',source_links:[{kind:'paper',paper_id:'p',page:null,block_id:'',research_page_id:''}]};
 component(tree,'ReviewContextEditor').props.add(derived);tree=h.render();assert.deepEqual(h.focus,[first.id,derived.id]);assert.equal(textareas(tree)[0].props.value,'Original comparison');
 const editors=nodes(tree,n=>n.type==='ReviewContextEditor');assert.deepEqual(editors[1].props.row.source_links,derived.source_links);assert.equal(editors[1].props.row.text,derived.text);
 const ordinary=nodes(tree,n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Add review record'))[0];ordinary.props.onClick();tree=h.render();assert.equal(h.focus.length,3);assert.equal(textareas(tree).length,3);tree=h.render();assert.equal(h.focus.length,3);h.unmount();
}));
test('refresh reloads saved rows without requesting focus',()=>browser(async()=>{
 const h=fixture({count:1});let tree=h.render();assert.deepEqual(h.focus,[]);
 await component(tree,'PageHeader').props.actions.props.onClick();await new Promise(resolve=>setImmediate(resolve));tree=h.render();assert.equal(h.requests.length,1);assert.deepEqual(h.focus,[]);assert.equal(textareas(tree).length,1);h.unmount();
}));
test('viewer, archived and full review guards reject additions even if handler is invoked',()=>browser(()=>{
 for(const options of [{role:'viewer'},{status:'archived'},{count:100}]){
  const h=fixture(options);let tree=h.render();component(tree,'ReviewWorkflow').props.add(model.newReviewRow());tree=h.render();assert.equal(textareas(tree).length,options.count||0);assert.deepEqual(h.focus,[]);h.unmount();
 }
}));
test('99th to 100th addition focuses last allowed row; subsequent addition leaves records and focus unchanged',()=>browser(()=>{
 const h=fixture({count:99});let tree=h.render();const last=model.newReviewRow();component(tree,'ReviewWorkflow').props.add(last);tree=h.render();assert.equal(textareas(tree).length,100);assert.deepEqual(h.focus,[last.id]);component(tree,'ReviewWorkflow').props.add(model.newReviewRow());tree=h.render();assert.equal(textareas(tree).length,100);assert.deepEqual(h.focus,[last.id]);h.unmount();
}));
