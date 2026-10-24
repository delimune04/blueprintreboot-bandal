// 글자수·바이트 세기. Pure functions shared by the page and its tests.

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
const graphemes = (text) => (segmenter ? [...segmenter.segment(text)].length : Array.from(text).length);

/**
 * Counts text the way Korean application forms usually do.
 * - Text is normalised to NFC first, so Hangul pasted as separate jamo
 *   (common from macOS file names) counts as whole syllables.
 * - 줄바꿈 counts as one character; byte counts treat it as CR+LF (2 bytes).
 * - utf8Bytes: 한글 3, 영문·숫자·공백 1, 줄바꿈 2 (NEIS·UTF-8 기준)
 * - legacyBytes: ASCII 1, 그 밖의 글자 2, 줄바꿈 2 (완성형 기준)
 */
export function countText(input) {
  const text = String(input ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
  const newlines = (text.match(/\n/g) || []).length;
  const compact = text.replace(/\s+/g, '');
  let legacy = 0;
  for (const char of text) {
    if (char === '\n') legacy += 2;
    else legacy += char.codePointAt(0) < 0x80 ? 1 : 2;
  }
  const trimmed = text.trim();
  return {
    chars: graphemes(text),
    charsNoSpace: graphemes(compact),
    utf8Bytes: new TextEncoder().encode(text).length + newlines,
    legacyBytes: legacy,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    lines: text ? newlines + 1 : 0,
    paragraphs: trimmed ? trimmed.split(/\n\s*\n/).filter((part) => part.trim()).length : 0,
    sentences: trimmed ? (trimmed.match(/[^.!?。…]+(?:[.!?。…]+|$)/g) || []).filter((part) => part.trim()).length : 0,
  };
}

/** Collapses runs of spaces/tabs inside lines and trims each line's ends. */
export function tidySpaces(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t 　]+/g, ' ').trim()).join('\n');
}

/** Leaves at most one empty line between paragraphs. */
export function tidyBlankLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').replace(/^\n+|\n+$/g, '');
}
