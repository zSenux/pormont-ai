"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, Loader2, Share, X } from "lucide-react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/app/actions";

// Übernommen aus Klaic OS (components/pwa.tsx): Service Worker, Push an/aus, iPhone-Installationshinweis

export function ServiceWorkerSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : "Gerät";
  const app = /JarvisPromont/i.test(ua) ? "Windows-App" : isStandalone() ? "App" : /edg\//i.test(ua) ? "Edge" : /chrome/i.test(ua) ? "Chrome" : /firefox/i.test(ua) ? "Firefox" : "Safari";
  return `${os} · ${app}`;
}

type PushState = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<PushState>("loading");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!vapidPublicKey) return setState("unsupported");
      if (isIos() && !isStandalone()) return setState("ios-install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [vapidPublicKey]);

  const enable = () =>
    start(async () => {
      setNote(null);
      try {
        // iOS verlangt, dass die Anfrage direkt aus einem Tippen kommt → hier im Klick-Handler
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) });
        await savePushSubscription(JSON.parse(JSON.stringify(sub)), deviceName());
        setState("on");
        const r = await sendTestPush();
        setNote(r.sent ? "Aktiviert ✓ – Test wurde gesendet." : "Aktiviert – Test konnte nicht gesendet werden.");
      } catch {
        setNote("Aktivieren hat nicht geklappt.");
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setNote(null);
    });

  if (state === "loading") return <p className="text-sm text-steel">Prüfe …</p>;
  if (state === "unsupported") return <p className="text-sm text-steel">{vapidPublicKey ? "Dieses Gerät/dieser Browser unterstützt keine Benachrichtigungen." : "Push ist auf dem Server noch nicht eingerichtet (VAPID-Schlüssel fehlen)."}</p>;
  if (state === "ios-install")
    return (
      <p className="text-sm text-steel">
        Auf dem iPhone erst Jarvis zum Home-Bildschirm hinzufügen (Teilen <Share className="inline size-3.5" /> → „Zum Home-Bildschirm“) und dann hier aus der App heraus aktivieren.
      </p>
    );
  if (state === "denied") return <p className="text-sm text-steel">Benachrichtigungen sind in den Geräte-Einstellungen blockiert.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "on" ? (
        <>
          <span className="chip border-green-200 bg-green-50 text-ok">An</span>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => start(async () => setNote((await sendTestPush()).sent ? "Test gesendet ✓" : "Kein Gerät erreicht"))}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />} Test senden
          </button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={disable}>
            <BellOff className="size-4" /> Ausschalten
          </button>
        </>
      ) : (
        <button type="button" className="btn-primary" disabled={pending} onClick={enable}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />} Benachrichtigungen aktivieren
        </button>
      )}
      {note && (
        <p className="w-full text-xs text-steel" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

/** Einmaliger Hinweis auf iPhone/iPad in Safari: Jarvis als App installieren */
export function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (isIos() && !isStandalone() && localStorage.getItem("jarvis-install-hint") !== "weg") setShow(true);
    } catch {}
  }, []);
  if (!show) return null;
  return (
    <div className="mx-auto mt-3 max-w-6xl px-4">
      <div className="card flex items-start gap-3 px-4 py-3 text-sm">
        <Share className="mt-0.5 size-4 shrink-0 text-brand" />
        <p className="flex-1 text-steel">
          <strong className="text-ink">Jarvis als App:</strong> unten auf <em>Teilen</em> tippen → „Zum Home-Bildschirm“. Dann startet Jarvis wie eine App und kann Benachrichtigungen schicken.
        </p>
        <button
          type="button"
          aria-label="Hinweis schließen"
          className="rounded-full p-1 text-steel hover:text-ink"
          onClick={() => {
            setShow(false);
            try {
              localStorage.setItem("jarvis-install-hint", "weg");
            } catch {}
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
