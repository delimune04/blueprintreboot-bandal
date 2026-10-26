// Page numbers are whole decimal integers. Invalid drafts return to the actual
// page instead of silently interpreting a prefix ("1.9" / "1e2") as another page.
export function normalizePdfPageInput(input, currentPage, totalPages) {
  const last = Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : 1;
  const current = Number.isSafeInteger(currentPage) ? Math.min(last, Math.max(1, currentPage)) : 1;
  const value = String(input).trim();
  if (!/^[+-]?\d+$/.test(value)) return current;
  const requested = Number(value);
  return Number.isSafeInteger(requested) ? Math.min(last, Math.max(1, requested)) : current;
}

// Only the focusable PDF viewport owns these keys. Descendant controls, IME,
// text editing, browser shortcuts, selection and normal scroll keys retain them.
export function pdfPageShortcut({ key, viewportFocused, altKey, ctrlKey, metaKey, shiftKey, isComposing, defaultPrevented }) {
  if (!viewportFocused || altKey || ctrlKey || metaKey || shiftKey || isComposing || defaultPrevented) return 0;
  if (key === "n" || key === "N") return 1;
  if (key === "p" || key === "P") return -1;
  return 0;
}
