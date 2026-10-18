export function memoSideFromPosition(position) {
  return Number.isFinite(position?.x) && position.x < 0.5 ? "left" : "right";
}

function bounds(value) {
  if (!value || ![value.left, value.top, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0) return null;
  return { left: value.left, top: value.top, right: value.left + value.width, bottom: value.top + value.height, width: value.width, height: value.height };
}
function intersection(...values) {
  const left = Math.max(...values.map(value => value.left)), top = Math.max(...values.map(value => value.top));
  const right = Math.min(...values.map(value => value.right)), bottom = Math.min(...values.map(value => value.bottom));
  return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}
function contains(outer, inner) {
  const tolerance = 0.5;
  return inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
}
function normalized(value) {
  return value && [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0 && value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001;
}
const rounded = value => Number(value.toFixed(2));

/** Coordinates are CSS pixels measured in the same viewport as the fixed SVG.
 * A partially visible source is used only when its actual rectangle center is
 * visible. A clipped memo is hidden instead of connecting to an unseen edge. */
export function computeMemoConnector({ noteRect, pageRect, viewportRect, rectangles, side, windowWidth, windowHeight, height, noteClipRect } = {}) {
  if (!["left", "right"].includes(side)) return null;
  const note = bounds(noteRect), page = bounds(pageRect), viewport = bounds(viewportRect);
  const screen = bounds({ left: 0, top: 0, width: windowWidth, height: windowHeight ?? height });
  const noteClip = noteClipRect ? bounds(noteClipRect) : screen;
  if (!note || !page || !viewport || !screen || !noteClip || !contains(screen, note) || !contains(noteClip, note)) return null;
  if (!Array.isArray(rectangles) || !rectangles.length || rectangles.length > 200 || !rectangles.every(normalized)) return null;
  const visible = intersection(page, viewport, screen);
  if (!visible) return null;
  const start = { x: side === "left" ? note.right : note.left, y: note.top + note.height / 2 };
  const targets = rectangles.map(rectangle => ({
    x: page.left + (rectangle.x + rectangle.width / 2) * page.width,
    y: page.top + (rectangle.y + rectangle.height / 2) * page.height,
  })).filter(point => point.x >= visible.left && point.x <= visible.right && point.y >= visible.top && point.y <= visible.bottom);
  if (!targets.length) return null;
  const end = targets.reduce((best, target) => Math.abs(target.y - start.y) < Math.abs(best.y - start.y) ? target : best);
  const direction = side === "left" ? 1 : -1;
  // Side notes must stay outside the document. Do not draw across a card if a
  // transitional/reflowed layout temporarily puts its source behind that card.
  if ((end.x - start.x) * direction <= 0) return null;
  const bend = Math.max(24, Math.min(96, Math.abs(end.x - start.x) * 0.4));
  const from = { x: rounded(start.x), y: rounded(start.y) }, to = { x: rounded(end.x), y: rounded(end.y) };
  const path = `M ${from.x} ${from.y} C ${rounded(start.x + direction * bend)} ${from.y}, ${rounded(end.x - direction * bend)} ${to.y}, ${to.x} ${to.y}`;
  return { start: from, end: to, path };
}
