import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as navigation from '../app/lib/review/navigation.mjs';
import * as model from '../app/lib/review/model.mjs';
const require = createRequire(import.meta.url);
const rows = ['hypothesis','decision','failed_attempt','question','next_action'].map((kind,i)=>({...model.newReviewRow(kind), id:`row${i}`,text:`Same record ${i}`,owner:'Researcher'}));
function harness(ko) {
 const states=[];let cursor=0;
 const hooks={...React,useState(initial){const id=cursor++;if(!(id in states))states[id]=initial;return[states[id],value=>{states[id]=value;}];}};
 const code=ts.transpileModule(readFileSync(new URL('../app/components/ReviewRecordNavigator.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
 const loaded={exports:{}};
 new Function('require','module','exports',code.outputText)(name=>name==='react'?hooks:name.endsWith('navigation.mjs')?navigation:name.endsWith('model.mjs')?model:require(name),loaded,loaded.exports);
 return {render(){cursor=0;return loaded.exports.ReviewRecordNavigator({rows,ko});}};
}
function findAll(node,type) {if(!node||typeof node!=='object')return[];return[...(node.type===type?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(child=>findAll(child,type))];}
test('bilingual kind labels distinguish equal-text records and expose six kind options',()=>{
 for(const ko of [true,false]){const tree=harness(ko).render();const html=renderToStaticMarkup(tree);assert.match(html,ko?/바로가기 기록 유형/:/Navigator record kind/);assert.equal(findAll(tree,'select')[1].props.children.flat().length,6);assert.match(html,ko?/실패한 시도/:/Failed attempts/);assert.equal(findAll(tree,'a').length,5);}
});
test('kind-only filter enables reset; combining criteria and clearing restores all source identities',()=>{
 const before=JSON.stringify(rows),h=harness(true);let tree=h.render();assert.equal(findAll(tree,'button')[0].props.disabled,true);
 findAll(tree,'select')[1].props.onChange({target:{value:'failed_attempt'}});tree=h.render();assert.equal(findAll(tree,'a').length,1);assert.equal(findAll(tree,'a')[0].props.href,'#review-row2');assert.equal(findAll(tree,'button')[0].props.disabled,false);
 findAll(tree,'input')[0].props.onChange({target:{value:'missing'}});tree=h.render();assert.equal(findAll(tree,'a').length,0);assert.match(renderToStaticMarkup(tree),/기록 유형 조건/);
 findAll(tree,'button')[0].props.onClick();tree=h.render();assert.equal(findAll(tree,'a').length,5);assert.equal(findAll(tree,'select')[1].props.value,'all');assert.equal(JSON.stringify(rows),before);
});
