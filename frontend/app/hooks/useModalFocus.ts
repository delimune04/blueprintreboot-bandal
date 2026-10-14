"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createModalFocusStack, modalFocusableElements, modalRestoreTarget, trapModalFocus } from "../lib/accessibility/modal-focus.mjs";

const modalFocusStack = createModalFocusStack();

type ModalFocusOptions = {
  active: boolean;
  onRequestClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

/** Provides keyboard behavior for nested temporary dialogs and navigation. */
export function useModalFocus<T extends HTMLElement>({
  active,
  onRequestClose,
  initialFocusRef,
  restoreFocusRef,
}: ModalFocusOptions) {
  const dialogRef = useRef<T | null>(null);
  const closeRef = useRef(onRequestClose);

  useEffect(() => {
    closeRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    const initialTarget = initialFocusRef?.current;
    const restoreTarget = restoreFocusRef?.current;
    const previousTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = modalFocusStack.push(dialog);
    let frame = window.requestAnimationFrame(() => {
      if (modalFocusStack.isTop(entry)) (initialTarget ?? modalFocusableElements(dialog)[0] ?? dialog)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modalFocusStack.isTop(entry)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (trapModalFocus(event, dialog)) event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      const { wasTop, next } = modalFocusStack.remove(entry);
      if (!wasTop) return;
      frame = window.requestAnimationFrame(() => {
        if (modalFocusStack.current() !== next) return;
        const target = modalRestoreTarget(next?.dialog, restoreTarget, previousTarget);
        if (target?.isConnected !== false) target?.focus();
      });
    };
  }, [active, initialFocusRef, restoreFocusRef]);

  return dialogRef;
}
