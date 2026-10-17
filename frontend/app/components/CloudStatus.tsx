"use client";
import { useEffect, useRef, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import { getWorkspaceMode, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";

export function CloudStatus() {
  const { locale } = useI18n();
  const [state, setState] = useState<"ready" | "saved" | "changed" | "offline">("ready");
  const latest = useRef("");
  useEffect(() => {
    if (getWorkspaceMode() !== "cloud") return;
    let active = true, pending = false;
    const check = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const info = await labviumRequest<{ revision: string }>("/workspace");
        if (!active) return;
        if (latest.current && info.revision < latest.current) return;
        if (latest.current && info.revision !== latest.current) setState("changed");
        else setState(value => value === "offline" ? "ready" : value);
        latest.current = info.revision;
      } catch { if (active) setState("offline"); } finally { pending = false; }
    };
    const saved = (event: Event) => { const detail = (event as CustomEvent<{revision:string}>).detail; if (detail.revision) latest.current = detail.revision; if (active) setState(value => value === "changed" ? "changed" : "saved"); };
    const focus = () => { void check(); };
    void check();
    const timer = window.setInterval(focus, 30000);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus); window.addEventListener("labvium:cloud-save", saved);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); window.removeEventListener("labvium:cloud-save", saved); };
  }, []);
  if (getWorkspaceMode() !== "cloud") return null;
  const labels = locale === "ko" ? { ready: "계정 저장 연결됨", saved: "계정에 저장됨", changed: "다른 기기의 변경 내용 있음", offline: "연결 확인 필요" } : { ready: "Account storage connected", saved: "Saved to account", changed: "Updates from another session", offline: "Connection unavailable" };
  return <span className={`lv-cloud-status lv-cloud-status--${state}`} role="status"><Cloud size={14} aria-hidden="true" />{labels[state]}{state === "changed" ? <button className="text-link" onClick={() => { if (window.confirm(locale === "ko" ? "저장하지 않은 내용을 먼저 저장해 주세요. 최신 저장본을 다시 열까요?" : "Save any unfinished edits first. Reload the latest saved workspace?")) window.location.reload(); }}><RefreshCw size={13} />{locale === "ko" ? "다시 열기" : "Reload"}</button> : null}</span>;
}
