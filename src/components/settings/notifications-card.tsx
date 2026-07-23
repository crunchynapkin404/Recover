"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  sendTestNotification,
  setMorningPush,
} from "@/app/settings/push-actions";

interface Props {
  vapidPublicKey: string;
  morningPushEnabled: boolean;
  subscriptionCount: number;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationsCard({
  vapidPublicKey,
  morningPushEnabled,
  subscriptionCount,
}: Props) {
  const [supported, setSupported] = useState(true);
  const [secure, setSecure] = useState(true);
  const [iosNotInstalled, setIosNotInstalled] = useState(false);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [morning, setMorning] = useState(morningPushEnabled);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Environment probing happens post-paint in a callback — React's lint
    // forbids synchronous setState in the effect body.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setSecure(window.isSecureContext);
      setSupported("serviceWorker" in navigator && "PushManager" in window);
      const standalone = window.matchMedia(
        "(display-mode: standalone)"
      ).matches;
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      setIosNotInstalled(ios && !standalone);
    });
    navigator.serviceWorker?.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setSubscribedHere(!!sub);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notifications were not allowed by the browser.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      // A stale subscription (e.g. from before the server's VAPID key
      // changed) must be dropped first — subscribe() silently returns the
      // existing one otherwise, even once it no longer matches the
      // server's key, and some browsers reject a differing key outright.
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      if (res.ok) {
        setSubscribedHere(true);
        toast.success("Notifications enabled on this device.");
      } else {
        toast.error("Could not save the subscription.");
      }
    } catch {
      toast.error("Enabling notifications failed on this device.");
    }
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribedHere(false);
      toast.success("Notifications disabled on this device.");
    } catch {
      toast.error("Disabling failed — try again.");
    }
  }

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro">Notifications</h3>
      <p className="mt-2 text-sm text-white/50">
        Your readiness score, pushed to this device every morning.
      </p>

      {!secure && (
        <p className="mt-3 text-sm text-amber-400" role="alert">
          Push needs HTTPS — open Recover through your tunnel or domain.
        </p>
      )}
      {iosNotInstalled && (
        <p className="mt-3 text-sm text-amber-400" role="alert">
          On iPhone, install the app first: Share → Add to Home Screen (iOS
          16.4+), then enable notifications from inside the installed app.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {subscribedHere ? (
          <button
            onClick={disable}
            className="rounded-2xl border border-white/10 py-3 text-sm font-bold text-white/70 transition-colors hover:bg-white/5"
          >
            Disable on this device
          </button>
        ) : (
          <button
            onClick={enable}
            disabled={!supported || !secure}
            className="rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
          >
            Enable notifications
          </button>
        )}

        <label className="flex items-center justify-between border-t border-white/5 py-3 text-sm font-medium">
          <span className="flex flex-col">
            <span>Morning readiness push</span>
            <span className="text-[10px] font-bold uppercase text-white/50">
              Sent when your score is computed
            </span>
          </span>
          <input
            type="checkbox"
            checked={morning}
            onChange={(e) => {
              const next = e.target.checked;
              setMorning(next);
              startTransition(() => setMorningPush(next));
            }}
            className="h-5 w-5 accent-emerald-500"
            aria-label="Morning readiness push"
          />
        </label>

        <button
          onClick={() =>
            startTransition(async () => {
              const res = await sendTestNotification();
              if (res.ok) toast.success(res.message);
              else toast.error(res.message);
            })
          }
          disabled={pending || (subscriptionCount === 0 && !subscribedHere)}
          className="rounded-2xl border border-white/10 py-3 text-sm font-bold text-white/70 transition-colors hover:bg-white/5 disabled:opacity-40"
        >
          Send test notification
        </button>
      </div>
    </section>
  );
}
