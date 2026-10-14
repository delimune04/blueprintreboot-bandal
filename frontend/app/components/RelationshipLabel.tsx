"use client";

import type { ProjectLinkType } from "../lib/api/types";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { relationshipTone } from "../lib/semantic-tones.mjs";

const RELATIONSHIP_LABELS: Record<ProjectLinkType, string> = {
  related: "Related",
  background: "Background",
  key_reference: "Key reference",
  supports_project: "Supports Project",
  raises_question: "Raises question",
  idea_for_project: "Idea for Project",
};

export function relationshipLabel(type: ProjectLinkType | string): string {
  return RELATIONSHIP_LABELS[type as ProjectLinkType] ?? type.replaceAll("_", " ");
}

export function RelationshipLabel({ type }: { type: ProjectLinkType | string }) {
  const { t } = useI18n();
  return <span className="relationship-label" data-relationship={type} data-tone={relationshipTone(type)}>{t(relationshipLabel(type))}</span>;
}
