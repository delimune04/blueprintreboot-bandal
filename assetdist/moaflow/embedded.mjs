// Presentation only: the ledger's storage keys and API identity never change.
export function ledgerPresentation(search = '') {
  const embedded = new URLSearchParams(search).get('embedded') === 'finance';
  return {
    embedded,
    label: embedded ? 'Finance 가계부' : '모아흐름',
    title: embedded ? 'Bandal Finance · 가계부' : '모아흐름 · 나의 작은 재무제표',
    home: embedded ? '/moaflow/?embedded=finance' : '/moaflow/',
    parent: embedded ? '/finance/#ledger' : '/',
    parentLabel: embedded ? 'Bandal Finance' : 'BANDAL STUDIO',
    signInUrl: embedded ? '/signin-with-chatgpt?return_to=%2Ffinance%2F%23ledger' : null,
    signOutUrl: embedded ? '/signout-with-chatgpt?return_to=%2Ffinance%2F%23ledger' : null,
  };
}
