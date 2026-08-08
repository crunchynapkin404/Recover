"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  sendTestNotification,
  setQuietHours,
  setMorningPush,
} from "@/app/settings/push-actions";

interface Props {
  vapidPublicKey: string;
  morningPushEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
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
  quietHoursStart,
  quietHoursEnd,
  subscriptionCount,
}: Props) {
  const [supported, setSupported] = useState(true);
  const [secure, setSecure] = useState(true);
  const [iosNotInstalled, setIosNotInstalled] = useState(false);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [morning, setMorning] = useState(morningPushEnabled);
  const [quietStart, setQuietStart] = useState(
    quietHoursStart == null ? "" : String(quietHoursStart)
  );
  const [quietEnd, setQuietEnd] = useState(
    quietHoursEnd == null ? "" : String(quietHoursEnd)
  );
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
  function parseHour(value: string): number | null {
    if (!value.trim()) return null;
    const hour = Number(value);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
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

        <div className="rounded-2xl border border-white/5 bg-white/3 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Quiet hours</span>
              <span className="text-[10px] font-bold uppercase text-white/50">
                Morning pushes stay silent inside this window
              </span>
            </span>
            <button
              onClick={() =>
                startTransition(async () => {
                  await setQuietHours(
                    parseHour(quietStart),
                    parseHour(quietEnd)
                  );
                  toast.success("Quiet hours saved.");
                })
              }
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-white/70 transition-colors hover:bg-white/5"
            >
              Save
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-2">
              <span className="text-white/50">Start hour</span>
              <input
                type="number"
                min={0}
                max={23}
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white outline-none"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-white/50">End hour</span>
              <input
                type="number"
                min={0}
                max={23}
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white outline-none"
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-white/40">
            Leave both blank to disable quiet hours.
          </p>
        </div>
      </div>
    </section>
  );
}
