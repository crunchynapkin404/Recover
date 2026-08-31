"use client";

import { useEffect, useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
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
      <p className="mt-2 text-caption text-ink-muted">
        Your readiness score, pushed to this device every morning.
      </p>

      {!secure && (
        <p className="mt-3 text-caption text-warning-ink" role="alert">
          Push needs HTTPS — open Recover through your tunnel or domain.
        </p>
      )}
      {iosNotInstalled && (
        <p className="mt-3 text-caption text-warning-ink" role="alert">
          On iPhone, install the app first: Share → Add to Home Screen (iOS
          16.4+), then enable notifications from inside the installed app.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {subscribedHere ? (
          <button
            onClick={disable}
            className="rounded-2xl border border-hairline py-3 text-caption font-bold text-ink-secondary transition-colors hover:bg-surface-selected"
          >
            Disable on this device
          </button>
        ) : (
          <button
            onClick={enable}
            disabled={!supported || !secure}
            // bg-accent text-accent-foreground (whole-branch review fix
            // wave, 2026-08-17): was `bg-emerald-500 ... text-black`, a raw
            // palette fill neither guard sees — ADHOC_INK only matches an
            // alpha-slashed white/black, and the per-task migration grep's
            // bare-color clause only ever checked `white`, never `black` —
            // so this survived every task's own check even though the
            // CHANGELOG claims all 16 files are on the token scale. This is
            // a primary action fill, exactly what --accent/--accent-foreground
            // is for. Dark's values are #10b981 / #000000. The foreground
            // half IS identical (Tailwind's --color-black is #000), but the
            // fill is not: Tailwind v4 ships emerald-500 as
            // oklch(69.6% 0.17 162.48), so "byte-identical", as this comment
            // read until v0.108.0, was false. Visually indistinguishable is
            // the true claim, and it is the one that matters here.
            className="rounded-2xl bg-accent py-3 text-caption font-bold text-accent-foreground transition-colors hover:opacity-90 disabled:opacity-40"
          >
            Enable notifications
          </button>
        )}

        <label className="flex items-center justify-between border-t border-hairline py-3 text-caption font-medium">
          <span className="flex flex-col">
            <span>Morning readiness push</span>
            <span className="text-label font-bold uppercase text-ink-muted">
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

        <PendingButton
          onClick={() =>
            startTransition(async () => {
              const res = await sendTestNotification();
              if (res.ok) toast.success(res.message);
              else toast.error(res.message);
            })
          }
          pending={pending}
          pendingLabel="Sending…"
          disabled={subscriptionCount === 0 && !subscribedHere}
          className="rounded-2xl border border-hairline py-3 text-caption font-bold text-ink-secondary transition-colors hover:bg-surface-selected disabled:opacity-40"
        >
          Send test notification
        </PendingButton>
      </div>
    </section>
  );
}
