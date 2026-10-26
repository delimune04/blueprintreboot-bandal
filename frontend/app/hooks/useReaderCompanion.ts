"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// One React tree and one stable portal host: moving between documents never
// creates a second editor, draft writer, transport, or AI request.
export function useReaderCompanion(title: string, locale: string) {
  const slot = useRef<HTMLDivElement>(null);
  const popup = useRef<Window | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [detached, setDetached] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const node = document.createElement("div");
    node.className = "reader-companion-host";
    slot.current?.appendChild(node);
    // Publish the newly created external DOM host after client-only mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(node);
    return () => { popup.current?.close(); popup.current = null; node.remove(); };
  }, []);
  const attach = useCallback(() => {
    if (host) slot.current?.appendChild(host);
    const child = popup.current;
    popup.current = null;
    child?.close();
    window.focus();
    setDetached(false);
  }, [host]);
  const open = useCallback(() => {
    if (!host) return false;
    if (popup.current && !popup.current.closed) { popup.current.focus(); return true; }
    // User-gesture only; no screen enumeration or Window Management permission.
    const child = window.open("", "_blank", "popup,width=700,height=900");
    if (!child) { setBlocked(true); return false; }
    try {
      child.document.title = `${title} · LabVium`;
      child.document.documentElement.lang = locale;
      child.document.documentElement.dataset.bandalDemo = document.documentElement.dataset.bandalDemo || "true";
      child.document.body.className = "reader-companion-window";
      child.document.body.dataset.bandalDemo = "true";
      const base = child.document.createElement("base"); base.href = document.baseURI; child.document.head.appendChild(base);
      document.querySelectorAll('link[rel="stylesheet"], style').forEach(style => child.document.head.appendChild(style.cloneNode(true)));
      child.document.body.appendChild(host);
      popup.current = child; setDetached(true); setBlocked(false); child.focus(); return true;
    } catch { child.close(); setBlocked(true); return false; }
  }, [host, locale, title]);
  useEffect(() => {
    if (!detached) return;
    const child = popup.current;
    const restore = () => { if (host) slot.current?.appendChild(host); popup.current = null; setDetached(false); };
    child?.addEventListener("pagehide", restore);
    const timer = window.setInterval(() => { if (!popup.current || popup.current.closed) restore(); }, 400);
    return () => { child?.removeEventListener("pagehide", restore); window.clearInterval(timer); };
  }, [detached, host]);
  useEffect(() => { if (popup.current && !popup.current.closed) { popup.current.document.title = `${title} · LabVium`; popup.current.document.documentElement.lang = locale; } }, [locale, title]);
  return { slot, host, detached, blocked, open, attach };
}
