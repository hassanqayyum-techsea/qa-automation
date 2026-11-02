"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Listens to /api/live (syncs finished, webhooks fired, runs finished) and re-renders the current
 * server page. Debounced so a burst of events causes one refresh.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource("/api/live");
    es.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [router]);
  return null;
}
