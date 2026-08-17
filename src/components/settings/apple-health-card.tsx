"use client";

import { useActionState, useState, useTransition } from "react";
import {
  disableAppleHealth,
  enableAppleHealth,
  uploadAppleHealthFile,
  type ActionResult,
} from "@/app/settings/apple-health-actions";
import {
  ConnectorCard,
  connectorPillClass,
  connectorGhostClass,
  connectorCtaClass,
  connectorBadgeClass,
} from "./connector-card";

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

  // Suppressed while the webhook URL is showing (result.url), so the two
  // never compete for the same line. Falls back to uploadState when there is
  // no button-driven result yet — the upload form's own outcome still needs
  // a status line, and it shares this one rather than duplicating it.
  const status =
    (result?.message || uploadState) && !result?.url
      ? {
          ok: result?.ok ?? uploadState?.ok ?? false,
          message: result?.message ?? uploadState?.message,
        }
      : null;

  return (
    <ConnectorCard
      name="Apple Health"
      tone="apple"
      glyph="♥"
      subtitle={
        connected ? "Push via Health Auto Export" : "Sleep, HRV, BP, body comp"
      }
      status={status}
      actions={
        connected ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () =>
                  setResult(await enableAppleHealth())
                )
              }
              className={connectorPillClass}
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
              className={connectorGhostClass}
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
            className={`${connectorCtaClass} bg-red-400 text-black hover:bg-red-300`}
          >
            Enable
          </button>
        ) : (
          <span className={connectorBadgeClass}>Set BETTER_AUTH_URL</span>
        )
      }
    >
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
        {/* The visible "File" span is the accessible name, not decoration.
            This input had none at all — no wrapping label, no aria-label, no
            title — an axe `label` violation of critical impact that is
            theme-independent and so was live in dark, the only theme the
            athlete can currently see. It went unfound because it sits in the
            Integrations section, one of five Collapsibles no capture had ever
            opened (v0.99 slice 5). Same fix as
            src/components/body/health-upload.tsx, which slice 3 corrected for
            the same reason: a real <label htmlFor> rather than an aria-label,
            so the control is clickable by its name as well as named. */}
        {/* Ink/type tokens on the one line this fix adds, rather than the
            ad-hoc alpha the input beside it still carries: the ratchet in
            tests/type-scale-guard.test.ts counts those by scanning source and
            only ever lets the number fall, so a bug fix that spent one would
            have to be paid back by slice 5's redesign. Same pair
            health-upload.tsx uses. (The scan reads comments too — naming the
            utility here literally would itself raise the count.) */}
        <label
          htmlFor="apple-health-upload-file"
          className="text-label text-ink-secondary flex min-w-0 flex-1 items-center gap-2"
        >
          <span className="shrink-0">File</span>
          <input
            id="apple-health-upload-file"
            type="file"
            name="file"
            accept="application/json,.json"
            className="min-w-0 flex-1 text-xs text-white/60 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-[10px] file:font-bold file:uppercase file:tracking-wider file:text-white/80"
          />
        </label>
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
    </ConnectorCard>
  );
}
