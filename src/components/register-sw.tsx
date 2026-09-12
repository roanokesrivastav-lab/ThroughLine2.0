"use client";
import { useEffect } from "react";

/** Registers the Serwist service worker in production builds. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("[sw] registration failed", err));
  }, []);
  return null;
}
