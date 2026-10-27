const PRESETS = Object.freeze([0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]);

// Keep the native select on the actual zoom, not an empty placeholder. Insert a
// fit/custom zoom between its neighbours so keyboard arrows remain predictable.
// Tiny arithmetic noise may select an equivalent preset without changing zoom.
export function pdfZoomSelection(zoom) {
  const current = Number.isFinite(zoom) ? Math.min(3, Math.max(0.1, zoom)) : 1;
  const equivalent = PRESETS.find(value => Math.abs(value - current) < 1e-9);
  const value = equivalent ?? current;
  const options = (equivalent === undefined ? [...PRESETS, current].sort((a, b) => a - b) : [...PRESETS])
    .map(option => ({ value: option, percent: Math.round(option * 100), custom: !PRESETS.includes(option) }));
  return { value, options };
}
