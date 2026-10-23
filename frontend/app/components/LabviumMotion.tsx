"use client";

import { useEffect } from "react";
import { mountLabviumMotion, mountLabviumSpotlight } from "./labvium-motion.mjs";

/** Optional one-time section entrances and card highlights. This component never owns user state. */
export function LabviumMotion({ scope = ".lv-home", refreshKey }: { scope?: string; refreshKey?: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(scope);
    if (!root || typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopEntrances = mountLabviumMotion(root, { preference, Observer: window.IntersectionObserver });
    const stopSpotlight = mountLabviumSpotlight(root, { preference, finePointer: window.matchMedia("(hover: hover) and (pointer: fine)") });
    return () => { stopEntrances(); stopSpotlight(); };
  }, [scope, refreshKey]);
  return null;
}
