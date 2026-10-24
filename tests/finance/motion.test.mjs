import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {sourceMarkup} from '../../assetdist/finance/explorer.mjs';

const root=new URL('../../assetdist/finance/',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const attributes=(html,name)=>[...html.matchAll(new RegExp(`\\s${name}="([^"]+)"`,'g'))].map(m=>m[1]);
// Calls visit(declaration, [...enclosing preludes]) for every declaration; enough for these stylesheets.
const walk=(css,visit)=>{const stack=[];let buffer='';for(const ch of css.replace(/\/\*[\s\S]*?\*\//g,'')){if(ch==='{'){stack.push(buffer.trim());buffer='';}else if(ch===';'||ch==='}'){const decl=buffer.trim();if(decl&&stack.length)visit(decl,[...stack]);buffer='';if(ch==='}')stack.pop();}else buffer+=ch;}};
// Every id app.mjs reads, as published at https://bandal.app/finance/ on 2026-10-24.
const IDS=['session','main','account-alert','view-ledger','ledger-title','ledger-mount','view-research','research-title','company-search','company-query','search-results','research-status','explorer-controls','explorer-sector','explorer-sort','explorer-direction','explorer-count','explorer-content','compare-tray','company-content','view-quant','quant-title','quant-guest','quant-private','new-strategy','strategy-select','strategy-form','delete-strategy','strategy-status','paper-form','prices-file','prices-input','sample-prices','data-label','paper-status','paper-result','refresh-runs','run-list','share-list','share-status','live-readiness','connection-status','connections-list','connection-form','connection-provider','live-area','live-form','live-connection','live-strategy','live-status','shared-result','shared-title','shared-content','toast'];
const SITE_ASSETS=['/moaflow/mark.svg','/fonts/pretendard/pretendardvariable-dynamic-subset.css','/transitions.css'];

test('motion skin keeps every published id and starts on the default research route',()=>{
 const html=read('index.html'),ids=attributes(html,'id');
 for(const id of IDS)assert(ids.includes(id),id);assert.equal(ids.length,new Set(ids).size);
 assert.match(html,/<body data-finance-tab="research">/);assert.match(html,/<section id="view-research" class="view" aria-labelledby="research-title">/);assert.match(html,/<section id="view-ledger" class="view" aria-labelledby="ledger-title" hidden>/);
 assert.match(html,/id="atlas-tape" class="atlas-tape" aria-hidden="true" hidden/);
});

test('motion skin loads only same-origin assets and makes no third-party requests',()=>{
 const html=read('index.html'),assets=[...html.matchAll(/<link[^>]+rel="(?:stylesheet|icon)"[^>]+href="([^"]+)"/g),...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
 for(const path of assets){if(SITE_ASSETS.includes(path))continue;assert.match(path,/^\.\/[\w.-]+$/,path);assert(existsSync(new URL(path,root)),path);}
 for(const file of ['finance-skin.css','finance-motion.js'])assert.doesNotMatch(read(file),/https?:\/\/(?!www\.w3\.org\/2000\/svg)/,file);
});

test('every skin animation is opt-in, pausable and never hides content without the script or in print',()=>{
 let animations=0,hiddenReveal=0,printReveal=false;
 walk(read('finance-skin.css'),(decl,stack)=>{
  const selector=stack.at(-1),media=stack.slice(0,-1).join(' ').replace(/\s+/g,'');
  if(/^animation(-name)?\s*:/.test(decl)&&!/:\s*none/.test(decl)){animations++;assert(media.includes('prefers-reduced-motion:no-preference'),selector);assert.match(selector,/:root(\.fx-js)?:not\(\.motion-paused\)/,selector);}
  if(/\.fx-reveal:not\(\.is-visible\)/.test(selector)&&/^opacity/.test(decl)){hiddenReveal++;assert(media.includes('prefers-reduced-motion:no-preference'));assert.match(selector,/:root\.fx-js:not\(\.motion-paused\)/);}
  if(media==='@mediaprint'&&selector==='.fx-reveal'&&/opacity:\s*1\s*!important/.test(decl))printReveal=true;
 });
 assert(animations>20);assert.equal(hiddenReveal,1);assert(printReveal);
 const script=read('finance-motion.js');assert.match(script,/prefers-reduced-motion: reduce/);assert.match(script,/const STORE_KEY = "bandal:motion"/);assert.match(script,/try \{\s*if \(userPaused\) localStorage/);
 assert.match(read('index.html'),/localStorage\.getItem\("bandal:motion"\)==="paused"/);
});

test('functional text is at least 11px; SVG text and logo fallbacks are sized by their boxes',()=>{
 const exempt=/(\btext\b|\.flow-value|\.chart-label|\.price-axis|\.spark-missing|\.company-logo|\.ticker-icon|\.brand-mark)/;
 for(const file of ['style.css','finance-skin.css'])walk(read(file),(decl,stack)=>{const px=/^font-size\s*:\s*([\d.]+)px/.exec(decl);if(px&&!exempt.test(stack.at(-1)))assert(Number(px[1])>=11,`${file}: ${stack.at(-1)} ${px[1]}px`);});
});

test('a source basis is labelled as a basis, not as a period',()=>{
 const marketCap={provider:'Yahoo Finance',url:'https://finance.yahoo.com/quote/AAPL/',basis:'Yahoo 제공 시가총액',asOf:'2026-10-23T20:00:01.000Z'};
 assert.match(sourceMarkup(marketCap),/<span>기준 Yahoo 제공 시가총액<\/span>/);assert.doesNotMatch(sourceMarkup(marketCap),/기간 Yahoo/);
 assert.match(sourceMarkup({...marketCap,start:'2024-09-29',end:'2025-09-27'}),/<span>기간 2024-09-29 ~ 2025-09-27<\/span>/);assert.doesNotMatch(sourceMarkup({...marketCap,periodEnd:'2025-09-27'}),/<span>기준 /);
});
