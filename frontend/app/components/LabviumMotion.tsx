"use client";

import { useEffect } from "react";
import { mountLabviumMotion } from "./labvium-motion.mjs";

/** Optional one-time section entrances. This component never owns user state. */
export function LabviumMotion({ scope = ".lv-home", refreshKey }: { scope?: string; refreshKey?: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(scope);
    if (!root || typeof window.matchMedia !== "function") return;
    return mountLabviumMotion(root, {
      preference: window.matchMedia("(prefers-reduced-motion: reduce)"),
      Observer: window.IntersectionObserver,
    });
  }, [scope, refreshKey]);
  return null;
}
