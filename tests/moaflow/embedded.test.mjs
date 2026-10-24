import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerPresentation } from '../../assetdist/moaflow/embedded.mjs';

test('Finance embeds the existing ledger without choosing or migrating a data owner', () => {
  const view = ledgerPresentation('?embedded=finance&owner=someone-else');
  assert.equal(view.embedded, true);
  assert.equal(view.label, 'Finance 가계부');
  assert.equal(view.parent, '/finance/#ledger');
  assert.equal(view.signInUrl, '/signin-with-chatgpt?return_to=%2Ffinance%2F%23ledger');
  assert.equal('owner' in view, false);
  assert.equal('storageKey' in view, false);
});
test('legacy bookmarks and arbitrary embed names retain their existing presentation', () => {
  for (const query of ['', '?embedded=elsewhere', '?share=public-token']) {
    const view = ledgerPresentation(query);
    assert.equal(view.embedded, false);
    assert.equal(view.home, '/moaflow/');
    assert.equal(view.signInUrl, null);
  }
});
