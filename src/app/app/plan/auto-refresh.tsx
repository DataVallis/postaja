"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a run is working, re-render the server page every few seconds (no websocket needed). */
export function AutoRefresh({ active, seconds = 3 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
}
