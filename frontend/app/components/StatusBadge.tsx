"use client";

import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { inferredStatusMarkerTone } from "../lib/semantic-tones.mjs";
import type { SemanticTone } from "../lib/semantic-tones.mjs";

type Tone = SemanticTone;
type Presentation = "label" | "chip" | "badge";
type Taxonomy = "canonical" | "alias" | "candidate";

export function StatusBadge({ tone, presentation, taxonomy, children }: { tone?: Tone; presentation?: Presentation; taxonomy?: Taxonomy; children: ReactNode }) {
  const { t } = useI18n();
  // Tags use the canonical-tag treatment; their text must never accidentally become a status tone.
  const inferredTone = inferredStatusMarkerTone(children, presentation);
  const resolvedTone = tone ?? inferredTone ?? (presentation === "chip" ? undefined : "slate");
  const resolvedPresentation = presentation ?? (tone === "amber" || tone === "rose" ? "badge" : "label");
  const label = resolvedPresentation !== "chip" && typeof children === "string" ? t(children) : children;
  return <span className={`status-badge status-badge--${resolvedPresentation}`} data-taxonomy={resolvedPresentation === "chip" ? taxonomy ?? "canonical" : undefined} data-tone={resolvedTone}>{label}</span>;
}
