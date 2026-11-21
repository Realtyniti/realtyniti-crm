"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Download, Share, SquarePlus } from "lucide-react";
import { removePushAction, savePushAction, testPushAction, type TeamState } from "@/app/team-actions";

/** Registers the service worker once, on every CRM screen. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function useDevice() {
  const [d, setD] = useState({ ios: false, standalone: false, ready: false });
  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setD({ ios, standalone, ready: true });
  }, []);
  return d;
}

/** "Install app" on Android and desktop Chrome; step-by-step for iPhone, where Safari has no button for it. */
export function InstallCard() {
  const { ios, standalone, ready } = useDevice();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!ready) return null;
  if (standalone || installed) {
    return <p className="text-[13.5px] text-good">You&apos;re using the installed app on this device.</p>;
  }
  if (ios) {
    return (
      <ol className="space-y-2 text-[13.5px] text-ink-2">
        <li className="flex items-start gap-2">
          <span className="font-semibold text-ink">1.</span>
          <span>
            Open this page in <b className="font-semibold">Safari</b>.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="font-semibold text-ink">2.</span>
          <span className="inline-flex flex-wrap items-center gap-1">
            Tap the Share button <Share className="size-4 text-accent" aria-label="Share" /> at the bottom.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="font-semibold text-ink">3.</span>
          <span className="inline-flex flex-wrap items-center gap-1">
            Choose <b className="font-semibold">Add to Home Screen</b> <SquarePlus className="size-4" aria-hidden />, then <b className="font-semibold">Add</b>.
          </span>
        </li>
        <li className="text-[12.5px] text-muted">Open RealtyNiti from the new icon, then come back here to switch on alerts.</li>
      </ol>
    );
  }
  if (prompt) {
    return (
      <button
        type="button"
        className="btn"
        onClick={async () => {
          await prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === "accepted") setInstalled(true);
          setPrompt(null);
        }}
      >
        <Download className="size-4" />
        Install RealtyNiti app
      </button>
    );
  }
  return (
    <p className="text-[13.5px] text-ink-2">
      In Chrome, open the <b className="font-semibold">⋮</b> menu and choose <b className="font-semibold">Install app</b> or{" "}
      <b className="font-semibold">Add to Home screen</b>.
    </p>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type AlertState = "loading" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

/** Turn new-lead alerts on or off for this one device. */
export function AlertsCard({ vapidKey, disabled }: { vapidKey: string | null; disabled?: boolean }) {
  const { ios, standalone, ready } = useDevice();
  const [state, setState] = useState<AlertState>("loading");
  const [msg, setMsg] = useState<TeamState>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone Safari only offers alerts inside the installed app.
        setState(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub && (!vapidKey || sameKey(sub.options.applicationServerKey, urlBase64ToUint8Array(vapidKey))) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [ready, ios, standalone, vapidKey]);

  async function turnOn() {
    if (!vapidKey) return;
    setBusy(true);
    setMsg({});
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const want = urlBase64ToUint8Array(vapidKey);
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with older keys can't receive alerts any more: replace it.
      if (sub && !sameKey(sub.options.applicationServerKey, want)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await savePushAction(json);
      setMsg(r);
      if (!r.error) setState("on");
    } catch {
      setMsg({ error: "This device would not turn alerts on. Try again, or use Chrome." });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMsg({});
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMsg({ ok: "Alerts are off for this device." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(await testPushAction());
    setBusy(false);
  }

  if (!vapidKey) {
    return <p className="text-[13.5px] text-muted">Alerts aren&apos;t switched on for the CRM yet (the server&apos;s alert keys are not set).</p>;
  }
  if (disabled) return <p className="text-[13.5px] text-muted">Switch alerts on from the live CRM, not this preview.</p>;

  return (
    <div className="space-y-3">
      {state === "loading" && <p className="text-[13.5px] text-muted">Checking this device…</p>}
      {state === "unsupported" && <p className="text-[13.5px] text-muted">This browser can&apos;t show alerts. On Android use Chrome; on iPhone, install the app first.</p>}
      {state === "needs-install" && (
        <p className="text-[13.5px] text-ink-2">
          On iPhone, alerts work only in the installed app. Add RealtyNiti to your Home Screen (steps above), open it from the icon, and
          come back here.
        </p>
      )}
      {state === "blocked" && (
        <p className="text-[13.5px] text-ink-2">
          Alerts are blocked for this site. Allow notifications for RealtyNiti in your phone&apos;s or browser&apos;s settings, then reload.
        </p>
      )}
      {state === "off" && (
        <button type="button" className="btn" onClick={turnOn} disabled={busy}>
          <Bell className="size-4" />
          {busy ? "Turning on…" : "Turn on new-lead alerts"}
        </button>
      )}
      {state === "on" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-[12.5px] font-semibold text-good">
            <Bell className="size-3.5" /> Alerts on for this device
          </span>
          <button type="button" className="btn-ghost h-8 px-2.5 text-[12.5px]" onClick={test} disabled={busy}>
            Send a test alert
          </button>
          <button type="button" className="btn-ghost h-8 px-2.5 text-[12.5px]" onClick={turnOff} disabled={busy}>
            <BellOff className="size-3.5" />
            Turn off
          </button>
        </div>
      )}
      {msg.error && <p className="text-[13px] text-hot">{msg.error}</p>}
      {msg.ok && state !== "on" && <p className="text-[13px] text-good">{msg.ok}</p>}
      {msg.ok && state === "on" && msg.ok.startsWith("Test") && <p className="text-[13px] text-good">{msg.ok}</p>}
    </div>
  );
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}
