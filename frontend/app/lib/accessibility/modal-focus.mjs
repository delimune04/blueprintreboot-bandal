export const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function modalFocusableElements(dialog) {
  return Array.from(dialog?.querySelectorAll?.(MODAL_FOCUSABLE_SELECTOR) ?? [])
    .filter((element) => !element.hasAttribute?.("disabled"));
}

export function trapModalFocus(event, dialog) {
  if (event.key !== "Tab") return false;
  const focusable = modalFocusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog?.focus?.();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeElement = dialog?.ownerDocument?.activeElement;
  if (event.shiftKey ? activeElement === first || !dialog?.contains?.(activeElement) : activeElement === last || !dialog?.contains?.(activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  return false;
}


/** Tracks nested overlays so only the top one owns keyboard focus. */
export function createModalFocusStack() {
  const entries = [];
  return {
    push(dialog) {
      const entry = { dialog };
      entries.push(entry);
      return entry;
    },
    current() {
      return entries.at(-1) ?? null;
    },
    isTop(entry) {
      return entries.at(-1) === entry;
    },
    remove(entry) {
      const index = entries.indexOf(entry);
      const wasTop = index !== -1 && index === entries.length - 1;
      if (index !== -1) entries.splice(index, 1);
      return { wasTop, next: entries.at(-1) ?? null };
    },
  };
}

export function modalRestoreTarget(dialog, requestedTarget, previousTarget) {
  if (!dialog) return requestedTarget ?? previousTarget ?? null;
  if (requestedTarget && dialog.contains(requestedTarget)) return requestedTarget;
  if (previousTarget && dialog.contains(previousTarget)) return previousTarget;
  return modalFocusableElements(dialog)[0] ?? dialog;
}
