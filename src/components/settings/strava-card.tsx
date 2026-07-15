"use client";

import { useState, useTransition } from "react";
import {
  setAutoDescribeStrava,
  stravaDisconnect,
  stravaSyncNow,
  type ActionResult,
} from "@/app/settings/strava-actions";

interface Props {
  configured: boolean; // STRAVA_CLIENT_ID present server-side
  connection: {
    athleteName: string;
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
    writeEnabled: boolean;
  } | null;
  autoDescribe: boolean;
  errorParam?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: "You declined the Strava authorization.",
  state_mismatch: "Sign-in state didn't match — try connecting again.",
  rejected:
    "Strava rejected the app credentials. Check STRAVA_CLIENT_ID/SECRET.",
  failed: "Connecting to Strava failed. Try again.",
};

export function StravaCard({
  configured,
  connection,
  autoDescribe,
  errorParam,
}: Props) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [auto, setAuto] = useState(autoDescribe);

  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10">
            <span aria-hidden className="text-xl text-orange-400">
              ↗
            </span>
          </div>
          <div>
            <p className="text-sm font-bold">Strava</p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              {connection
                ? `Connected as ${connection.athleteName}`
                : "Not connected"}
            </span>
          </div>
        </div>

        {connection ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await stravaSyncNow()))
              }
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {pending ? "…" : "Sync"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await stravaDisconnect()))
              }
              className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : configured ? (
          <a
            href="/api/connections/strava"
            className="rounded-full bg-orange-500 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-orange-400"
          >
            Connect
          </a>
        ) : (
          <span className="rounded bg-white/5 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-white/50">
            Set STRAVA_CLIENT_ID
          </span>
        )}
      </div>

      {(errorParam || result || connection?.lastError) && (
        <p
          role="status"
          className={`mt-3 text-xs ${
            result?.ok ? "text-white/60" : "text-red-400"
          }`}
        >
          {result?.message ??
            (errorParam ? ERROR_MESSAGES[errorParam] : null) ??
            `Last error: ${connection?.lastError}`}
        </p>
      )}

      {connection && !connection.writeEnabled && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-orange-500/20 bg-orange-500/10 p-3">
          <p className="text-xs text-white/80">
            Upgrade Strava connection for AI descriptions
          </p>
          <a
            href="/api/connections/strava"
            className="shrink-0 rounded-full bg-orange-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-orange-400"
          >
            Reconnect
          </a>
        </div>
      )}

      {connection?.writeEnabled && (
        <label className="mt-3 flex items-center justify-between gap-3 border-t border-white/5 pt-3 text-sm font-medium">
          <span className="flex flex-col">
            <span>Auto-describe new activities on Strava</span>
            <span className="text-[10px] font-bold uppercase text-white/50">
              Uses intervals.icu metrics — never reads your Strava data
            </span>
          </span>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              const next = e.target.checked;
              setAuto(next);
              startTransition(() => setAutoDescribeStrava(next));
            }}
            className="h-5 w-5 shrink-0 accent-emerald-500"
            aria-label="Auto-describe new activities on Strava"
          />
        </label>
      )}

      <div className="mt-3 border-t border-white/5 pt-3">
        <p className="text-[10px] text-white/50">
          Powered by Strava. Strava data is shown here but{" "}
          <strong className="text-white/70">
            never sent to the AI coach or MCP clients
          </strong>{" "}
          (Strava API terms).
        </p>
      </div>
    </div>
  );
}
