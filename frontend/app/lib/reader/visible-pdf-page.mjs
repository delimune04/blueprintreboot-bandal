export function visiblePdfPage(pages, viewportTop, viewportHeight) {
  const center = viewportTop + viewportHeight / 2;
  let nearest = null;
  let distance = Infinity;
  for (const page of pages) {
    if (!Number.isInteger(page.page) || page.page < 1 || !Number.isFinite(page.top) || !Number.isFinite(page.height) || page.height <= 0) continue;
    if (page.top <= center && page.top + page.height >= center) return page.page;
    const candidateDistance = Math.min(Math.abs(center - page.top), Math.abs(center - page.top - page.height));
    if (candidateDistance < distance) { nearest = page.page; distance = candidateDistance; }
  }
  return nearest;
}
