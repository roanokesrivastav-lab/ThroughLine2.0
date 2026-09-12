"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, useProfile } from "@/lib/api";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Web Push opt-in. Everything degrades quietly when unsupported or unconfigured. */
export function usePushSubscription() {
  const profile = useProfile();
  const supported = useSyncExternalStore(() => () => {}, () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window, () => false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = !!profile.data?.capabilities.vapidPublicKey;

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription()).then((sub) => { if (!cancelled) setSubscribed(!!sub); }).catch(() => {});
    return () => { cancelled = true; };
  }, [supported]);

  const subscribe = useCallback(async () => {
    setError(null); setBusy(true);
    try {
      const key = profile.data?.capabilities.vapidPublicKey;
      if (!key) throw new Error("Push is not configured.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications were not allowed.");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const json = sub.toJSON();
      await api("/api/push/subscribe", { method: "POST", json: { endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent } });
      await api("/api/settings", { method: "PATCH", json: { notificationPrefs: { push: true } } });
      setSubscribed(true);
      profile.refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }, [profile]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api("/api/push/subscribe", { method: "DELETE", json: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      await api("/api/settings", { method: "PATCH", json: { notificationPrefs: { push: false } } });
      setSubscribed(false);
      profile.refetch();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }, [profile]);

  return { supported, configured, subscribed, busy, error, subscribe, unsubscribe };
}
