"use client";

import { StatusBadge } from "./StatusBadge";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { saveStateLabel } from "../lib/drafts/revision-draft.mjs";
import type { SaveState } from "../lib/drafts/revision-draft.mjs";

export function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useI18n();
  const tone = state === "saved"
    ? "green"
    : state === "unsaved" || state === "saving"
      ? "blue"
      : "rose";
  return <StatusBadge tone={tone}>{t(saveStateLabel(state))}</StatusBadge>;
}
