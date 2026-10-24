// 논문 인용 생성. Pure functions shared by the page and its tests.
// Titles keep the capitalisation the publisher registered; the page says so.

const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (value) => String(value ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/** Accepts "10.xxxx/...", "doi:10...." or a doi.org URL; returns the bare DOI or null. */
export function parseDoi(input) {
  const text = decodeURIComponent(String(input ?? '').trim());
  const match = /(10\.\d{4,9}\/[^\s"<>]+)$/i.exec(text.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, ''));
  return match ? match[1].replace(/[.,;]+$/, '') : null;
}

/** Normalises a Crossref /works message. */
export function fromCrossref(message) {
  const m = message || {};
  const date = m.issued?.['date-parts']?.[0] || m['published-print']?.['date-parts']?.[0] || m['published-online']?.['date-parts']?.[0] || [];
  const first = (value) => clean(Array.isArray(value) ? value[0] : value);
  return {
    type: m.type || 'other',
    title: first(m.title),
    subtitle: first(m.subtitle),
    authors: (m.author || []).map((a) => (a.family ? { family: clean(a.family), given: clean(a.given) } : { literal: clean(a.name || a.given || '') })).filter((a) => a.family || a.literal),
    container: first(m['container-title']),
    year: Number.isInteger(date[0]) ? date[0] : null,
    month: Number.isInteger(date[1]) ? date[1] : null,
    volume: clean(m.volume),
    issue: clean(m.issue),
    pages: clean(m.page),
    article: clean(m['article-number']),
    publisher: clean(m.publisher),
    doi: clean(m.DOI),
  };
}

const initials = (given) => String(given || '').split(/\s+/).filter(Boolean)
  .map((part) => part.split('-').map((piece) => (/^[A-Za-z]\.?$/.test(piece) ? `${piece[0]}.` : `${Array.from(piece)[0]}.`)).join('-'))
  .join(' ');
const range = (pages, dash = '–') => pages.replace(/\s*[-–—]\s*/g, dash);
const doiUrl = (doi) => (doi ? `https://doi.org/${doi}` : '');
const fullTitle = (w) => (w.subtitle ? `${w.title}: ${w.subtitle}` : w.title);
const endWith = (text, mark = '.') => (/[.?!]$/.test(text) ? text : `${text}${mark}`);
const isBook = (w) => w.type === 'book' || w.type === 'monograph' || w.type === 'edited-book';
const inBook = (w) => w.type === 'book-chapter' || w.type === 'proceedings-article';
const join = (parts, last = '&') => (parts.length <= 1 ? parts.join('') : parts.length === 2 ? `${parts[0]}, ${last} ${parts[1]}` : `${parts.slice(0, -1).join(', ')}, ${last} ${parts.at(-1)}`);

function result(segments) {
  // segments: strings or { i: text } for italics
  const text = segments.map((s) => (typeof s === 'string' ? s : s.i)).join('');
  const html = segments.map((s) => (typeof s === 'string' ? escapeHtml(s) : `<i>${escapeHtml(s.i)}</i>`)).join('');
  return { text: text.replace(/\s+/g, ' ').trim(), html: html.replace(/\s+/g, ' ').trim() };
}

export function apa(w) {
  const names = w.authors.map((a) => (a.literal ? a.literal : `${a.family}${a.given ? `, ${initials(a.given)}` : ''}`));
  const list = names.length > 20 ? `${names.slice(0, 19).join(', ')}, . . . ${names.at(-1)}` : join(names, '&');
  const year = `(${w.year || 'n.d.'}).`;
  const head = list ? `${endWith(list)} ${year} ` : '';
  const title = endWith(fullTitle(w));
  const link = doiUrl(w.doi);
  if (isBook(w)) return result([list ? head : '', { i: endWith(fullTitle(w)).slice(0, -1) }, `.${list ? '' : ` ${year}`} ${w.publisher ? `${endWith(w.publisher)} ` : ''}${link}`]);
  if (inBook(w)) return result([head || '', `${title} In `, { i: w.container || '' }, `${w.pages ? ` (pp. ${range(w.pages)})` : ''}. ${w.publisher ? `${endWith(w.publisher)} ` : ''}${link}`]);
  const tail = [];
  if (w.volume) tail.push({ i: w.volume });
  return result([
    head || '', `${title} `,
    { i: w.container || '' },
    w.volume ? ', ' : '', ...tail,
    w.issue ? `(${w.issue})` : '',
    w.pages ? `, ${range(w.pages)}` : w.article ? `, Article ${w.article}` : '',
    '. ', link,
  ]);
}

export function mla(w) {
  const a = w.authors;
  const name = (x, inverted) => (x.literal ? x.literal : inverted ? `${x.family}${x.given ? `, ${x.given}` : ''}` : `${x.given ? `${x.given} ` : ''}${x.family}`);
  const list = !a.length ? '' : a.length === 1 ? name(a[0], true) : a.length === 2 ? `${name(a[0], true)}, and ${name(a[1], false)}` : `${name(a[0], true)}, et al`;
  const head = list ? `${endWith(list)} ` : '';
  const link = doiUrl(w.doi);
  if (isBook(w)) return result([head, { i: fullTitle(w) }, `. ${w.publisher ? `${w.publisher}, ` : ''}${w.year || ''}. ${link}`]);
  const parts = [];
  if (w.volume) parts.push(`vol. ${w.volume}`);
  if (w.issue) parts.push(`no. ${w.issue}`);
  if (w.year) parts.push(String(w.year));
  if (w.pages) parts.push(`pp. ${range(w.pages, '-')}`);
  return result([head, `“${endWith(fullTitle(w))}” `, { i: w.container || '' }, parts.length ? `, ${parts.join(', ')}` : '', '. ', link]);
}

export function chicago(w) {
  const a = w.authors;
  const name = (x, inverted) => (x.literal ? x.literal : inverted ? `${x.family}${x.given ? `, ${x.given}` : ''}` : `${x.given ? `${x.given} ` : ''}${x.family}`);
  const names = a.map((x, i) => name(x, i === 0));
  const list = names.length > 10 ? `${names.slice(0, 7).join(', ')}, et al` : names.length <= 2 ? names.join(', and ') : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
  const head = list ? `${endWith(list)} ${w.year || 'n.d.'}. ` : '';
  const link = doiUrl(w.doi);
  if (isBook(w)) return result([head, { i: fullTitle(w) }, `. ${w.publisher ? `${w.publisher}. ` : ''}${link}`]);
  if (inBook(w)) return result([head, `“${endWith(fullTitle(w))}” In `, { i: w.container || '' }, `${w.pages ? `, ${range(w.pages)}` : ''}. ${w.publisher ? `${w.publisher}. ` : ''}${link}`]);
  return result([head, `“${endWith(fullTitle(w))}” `, { i: w.container || '' }, w.volume ? ` ${w.volume}` : '', w.issue ? ` (${w.issue})` : '', w.pages ? `: ${range(w.pages)}` : '', '. ', link]);
}

export function ieee(w) {
  const names = w.authors.map((x) => (x.literal ? x.literal : `${x.given ? `${initials(x.given)} ` : ''}${x.family}`));
  const list = names.length > 6 ? `${names[0]} et al.` : names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
  const head = list ? `${list}, ` : '';
  const when = [w.month ? MONTHS[w.month - 1] : '', w.year || ''].filter(Boolean).join(' ');
  if (isBook(w)) return result([head, { i: fullTitle(w) }, `. ${w.publisher ? `${w.publisher}, ` : ''}${w.year || ''}${w.doi ? `, doi: ${w.doi}` : ''}.`]);
  const parts = [];
  if (w.volume) parts.push(`vol. ${w.volume}`);
  if (w.issue) parts.push(`no. ${w.issue}`);
  if (w.pages) parts.push(`${/[-–]/.test(w.pages) ? 'pp.' : 'p.'} ${range(w.pages)}`);
  else if (w.article) parts.push(`Art. no. ${w.article}`);
  if (when) parts.push(when);
  return result([head, `“${fullTitle(w)},” `, inBook(w) ? 'in ' : '', { i: w.container || '' }, parts.length ? `, ${parts.join(', ')}` : '', w.doi ? `, doi: ${w.doi}.` : '.']);
}

export function bibtex(w) {
  const type = w.type === 'journal-article' ? 'article' : w.type === 'proceedings-article' ? 'inproceedings' : isBook(w) ? 'book' : w.type === 'book-chapter' ? 'incollection' : 'misc';
  const ascii = (value) => String(value || '').normalize('NFKD').replace(/[^\w]/g, '').toLowerCase();
  const key = `${ascii(w.authors[0]?.family || w.authors[0]?.literal || 'ref')}${w.year || ''}${ascii((w.title.match(/[A-Za-z0-9]+/) || [''])[0])}` || 'ref';
  const tex = (value) => String(value).replace(/([&%$#_])/g, '\\$1');
  const fields = [
    ['author', w.authors.map((a) => (a.literal ? `{${tex(a.literal)}}` : `${tex(a.family)}${a.given ? `, ${tex(a.given)}` : ''}`)).join(' and ')],
    ['title', `{${tex(fullTitle(w))}}`],
    [type === 'inproceedings' || type === 'incollection' ? 'booktitle' : 'journal', type === 'book' || type === 'misc' ? '' : tex(w.container)],
    ['year', w.year ? String(w.year) : ''],
    ['volume', w.volume],
    ['number', w.issue],
    ['pages', w.pages ? range(w.pages, '--') : ''],
    ['publisher', type === 'book' || type === 'incollection' ? tex(w.publisher) : ''],
    ['doi', w.doi],
  ].filter(([, value]) => value);
  const text = `@${type}{${key},\n${fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
  return { text, html: escapeHtml(text) };
}

export const STYLES = [
  { id: 'apa', label: 'APA 7', format: apa },
  { id: 'mla', label: 'MLA 9', format: mla },
  { id: 'chicago', label: 'Chicago', format: chicago },
  { id: 'ieee', label: 'IEEE', format: ieee },
  { id: 'bibtex', label: 'BibTeX', format: bibtex },
];
