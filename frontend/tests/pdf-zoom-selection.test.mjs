import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfZoomSelection } from '../app/lib/pdf/zoom-selection.mjs';

test('preset selection starts on the actual zoom and has no empty placeholder', () => {
  for (const value of [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]) {
    const result = pdfZoomSelection(value);
    assert.equal(result.value, value);
    assert.equal(result.options.length, 9);
    assert.equal(result.options.filter(option => option.value === result.value).length, 1);
    assert.ok(result.options.every(option => !option.custom && Number.isFinite(option.value)));
  }
  const result = pdfZoomSelection(0.75), index = result.options.findIndex(option => option.value === result.value);
  assert.equal(result.options[index + 1].value, 1);
  assert.equal(result.options[index - 1].value, 0.5);
});
test('fit and manual intermediate zooms sit between their neighbouring presets', () => {
  for (const zoom of [0.1001, 0.37, 0.751, 1.22, 1.999, 2.99]) {
    const {value, options} = pdfZoomSelection(zoom);
    assert.equal(value, zoom);
    assert.equal(options.filter(option => option.custom).length, 1);
    assert.equal(options.find(option => option.custom).value, zoom);
    assert.deepEqual(options.map(option => option.value), options.map(option => option.value).toSorted((a,b) => a-b));
    const next = pdfZoomSelection(options[options.findIndex(option => option.value === value) + 1].value);
    assert.equal(next.options.length, 9, 'Selecting a preset removes the old temporary fit option');
  }
});
test('floating point noise does not create duplicate preset entries', () => {
  const result = pdfZoomSelection(0.7500000000000001);
  assert.equal(result.value, 0.75);
  assert.equal(result.options.length, 9);
});
test('invalid or out of range input is bounded without mutating shared options', () => {
  for (const input of [NaN, Infinity, -Infinity]) assert.equal(pdfZoomSelection(input).value, 1);
  assert.equal(pdfZoomSelection(-1).value, 0.1);
  assert.equal(pdfZoomSelection(100).value, 3);
  pdfZoomSelection(1).options.splice(0);
  assert.equal(pdfZoomSelection(1).options.length, 9);
});
