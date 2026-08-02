"use client";

import { useActionState, useState, useTransition } from "react";
import {
  disableAppleHealth,
  enableAppleHealth,
  uploadAppleHealthFile,
  type ActionResult,
} from "@/app/settings/apple-health-actions";

/** Health Auto Export pushes at least daily when healthy; 3 days of silence
 *  is well past any plausible gap. */
const STALE_AFTER_DAYS = 3;

/**
 * Whole days of silence from a push connector, or null while it is still
 * plausibly live. A push source has no failure signal of its own — it just
 * stops — so silence is the only symptom there is.
 */
export function staleSilenceDays(
  lastSyncAt: string | null,
  now: Date = new Date()
): number | null {
  if (!lastSyncAt) return null;
  const then = new Date(lastSyncAt).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  return days >= STALE_AFTER_DAYS ? days : null;
}

interface Props {
  connected: boolean;
  lastSyncAt: string | null;
  baseUrlConfigured: boolean; // BETTER_AUTH_URL present
}

export function AppleHealthCard({
  connected,
  lastSyncAt,
  baseUrlConfigured,
}: Props) {
  const [result, setResult] = useState<
    (ActionResult & { url?: string }) | null
  >(null);
  const [pending, startTransition] = useTransition();

  const staleDays = staleSilenceDays(lastSyncAt);
  const [uploadState, uploadAction, uploading] = useActionState<
    ActionResult | null,
    FormData
  >(uploadAppleHealthFile, null);

  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10">
            <span aria-hidden className="text-base text-red-300">
              ♥
            </span>
          </div>
          <div>
            <p className="text-sm font-bold">Apple Health</p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              {connected
                ? "Push via Health Auto Export"
                : "Sleep, HRV, BP, body comp"}
            </span>
          </div>
        </div>

        {connected ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () =>
                  setResult(await enableAppleHealth())
                )
              }
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              New URL
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () =>
                  setResult(await disableAppleHealth())
                )
              }
              className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              Disable
            </button>
          </div>
        ) : baseUrlConfigured ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => setResult(await enableAppleHealth()))
            }
            className="rounded-full bg-red-400 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-red-300 disabled:opacity-50"
          >
            Enable
          </button>
        ) : (
          <span className="rounded bg-white/5 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-white/50">
            Set BETTER_AUTH_URL
          </span>
        )}
      </div>

      {result?.url && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
            Webhook URL — paste into Health Auto Export (REST API automation)
          </p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl border border-white/5 bg-black/30 p-3 text-xs text-white/80">
            {result.url}
          </pre>
          <p className="mt-1 text-[10px] text-orange-400">
            Shown once — copy it now. Generating a new URL invalidates the old.
          </p>
        </div>
      )}

      {(result?.message || uploadState) && !result?.url && (
        <p
          role="status"
          className={`mt-3 text-xs ${
            (result?.ok ?? uploadState?.ok) ? "text-white/60" : "text-red-400"
          }`}
        >
          {result?.message ?? uploadState?.message}
        </p>
      )}

      {connected && lastSyncAt && (
        <p className="mt-2 text-[10px] text-white/40">
          Last received: {new Date(lastSyncAt).toLocaleString()}
        </p>
      )}

      {/* A push connector has no failure signal of its own — it just goes
          quiet. Without this, a connector that stopped days ago (an expired
          Health Auto Export subscription, a revoked automation) keeps
          reading as healthy indefinitely. */}
      {connected && staleDays != null && (
        <p role="status" className="mt-1 text-[10px] font-bold text-amber-300">
          Nothing received for {staleDays} days — check the Health Auto Export
          automation is still running.
        </p>
      )}

      <form
        action={uploadAction}
        className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3"
      >
        <input
          type="file"
          name="file"
          accept="application/json,.json"
          className="min-w-0 flex-1 text-xs text-white/60 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-[10px] file:font-bold file:uppercase file:tracking-wider file:text-white/80"
        />
        <button
          type="submit"
          disabled={uploading}
          className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          {uploading ? "…" : "Upload"}
        </button>
      </form>
      <p className="mt-1 text-[10px] text-white/40">
        Or upload a one-off Health Auto Export JSON file.
      </p>
    </div>
  );
}
