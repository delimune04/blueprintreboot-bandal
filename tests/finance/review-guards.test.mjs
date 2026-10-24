import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../../assetdist/finance/app.mjs',import.meta.url),'utf8');
const fn=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*`,'m'))?.[0]||'';

test('a same-account session re-check hides the embedded ledger instead of destroying its drafts',()=>{
 const check=fn('checkSession');
 assert.match(check,/if\(!initial\)\{\$\('#quant-private'\)\.hidden=true;\$\('#ledger-mount'\)\.hidden=true;\}/);
 assert.doesNotMatch(check,/ledger-mount'\)\.replaceChildren/);
 assert.match(check,/state\.session=s;renderSession\(\);renderQuantSession\(\);\$\('#ledger-mount'\)\.hidden=false;mountLedger\(\);/);
 assert.match(check,/state\.session\?\.user\?\.key!==s\.user\?\.key\)\{lockAccount\(\);return;\}/,'an account change still locks');
 assert.match(fn('lockAccount'),/\$\('#ledger-mount'\)\.replaceChildren\(\)/,'locking still removes the frame');
 assert.doesNotMatch(fn('selectTab'),/ledger-mount'\)\.replaceChildren/,'switching Finance tabs keeps the frame');
});

test('a strategy form saves against the revision it was filled from',()=>{
 assert.match(fn('fillStrategy'),/state\.formRevision=s\?s\.revision:null;/);
 assert.match(app,/body:\{\.\.\.input,\.\.\.\(existing\?\{revision:state\.formRevision\}:\{\}\)\}\}\);state\.selected=result\.strategy\.id;state\.formRevision=result\.strategy\.revision;/);
 assert.doesNotMatch(app,/revision:existing\.revision/,'a refreshed list no longer supplies the revision');
 assert.match(app,/if\(error\.status===409&&error\.code!==ACCOUNT_CHANGED&&state\.selected\)\{await loadPrivate\(\);[^}]*최신 전략 불러오기[^}]*fillStrategy\(state\.selected\)/,'a conflict keeps the edits and offers an explicit reload');
 assert.match(fn('lockAccount'),/state\.formRevision=null;/);
});
