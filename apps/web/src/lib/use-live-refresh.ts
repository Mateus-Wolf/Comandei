"use client";
import { useEffect, useRef } from "react";

// Refreshes never overlap and are cancelled when the selected resource changes.
export function useLiveRefresh(
  key: string | undefined,
  refresh: (signal: AbortSignal) => Promise<unknown>,
  enabled = true,
) {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!key || !enabled) return;
    let controller: AbortController | undefined;
    const run = () => {
      if (
        controller ||
        document.visibilityState !== "visible" ||
        !navigator.onLine
      )
        return;
      // Preserve input and financial confirmation snapshots while the operator edits.
      if (document.activeElement?.matches("input, textarea, select")) return;
      controller = new AbortController();
      const signal = controller.signal;
      void callback
        .current(signal)
        .catch(() => {})
        .finally(() => {
          controller = undefined;
        });
    };
    const timer = window.setInterval(run, 15000);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
      controller?.abort();
    };
  }, [key, enabled]);
}
