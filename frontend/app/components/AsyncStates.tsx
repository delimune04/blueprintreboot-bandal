"use client";

import { AlertCircle, CloudOff, FileQuestion, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n/LocaleProvider";

function StateFrame({ icon, title, description, role, action }: { icon: ReactNode; title: string; description: string; role?: "status" | "alert"; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="state-frame" role={role}>
      <span className="state-frame__icon" aria-hidden="true">{icon}</span>
      <div><h2>{t(title)}</h2><p>{t(description)}</p></div>
      {action ? <div className="state-frame__action">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading workspace data" }: { label?: string }) {
  return <StateFrame role="status" icon={<LoaderCircle className="loading-icon" size={20} />} title={label} description="Reading from the local BluePrintReboot API." />;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <StateFrame role="status" icon={<FileQuestion size={20} />} title={title} description={description} />;
}

function RetryAction({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return <button className="state-retry" type="button" onClick={onRetry}>{t("Retry")}</button>;
}

export function ErrorState({ title = "Unable to load this view", description, onRetry }: { title?: string; description: string; onRetry?: () => void }) {
  return <StateFrame role="alert" icon={<AlertCircle size={20} />} title={title} description={description} action={onRetry ? <RetryAction onRetry={onRetry} /> : undefined} />;
}

export function UnavailableState({ title = "Local API unavailable", description = "Start the local FastAPI service to connect this view. The application shell remains available offline.", onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return <StateFrame role="status" icon={<CloudOff size={20} />} title={title} description={description} action={onRetry ? <RetryAction onRetry={onRetry} /> : undefined} />;
}
