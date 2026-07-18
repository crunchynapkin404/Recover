"use client";

import { useState, useTransition } from "react";
import {
  withingsDisconnect,
  withingsSyncNow,
  type ActionResult,
} from "@/app/settings/withings-actions";

interface Props {
  configured: boolean; // WITHINGS_CLIENT_ID/SECRET present server-side
  connection: {
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
  } | null;
  errorParam?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: "You declined the Withings authorization.",
  state_mismatch: "Sign-in state didn't match — try connecting again.",
  rejected:
    "Withings rejected the app credentials. Check WITHINGS_CLIENT_ID/SECRET.",
  failed: "Connecting to Withings failed. Try again.",
};

export function WithingsCard({ configured, connection, errorParam }: Props) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-teal-400/20 bg-teal-400/10">
            <span aria-hidden className="text-base text-teal-300">
              ⚖
            </span>
          </div>
          <div>
            <p className="text-sm font-bold">Withings</p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              {connection
                ? "Connected"
                : "Weight, body composition, blood pressure"}
            </span>
          </div>
        </div>

        {connection ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await withingsSyncNow()))
              }
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {pending ? "…" : "Sync"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () =>
                  setResult(await withingsDisconnect())
                )
              }
              className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : configured ? (
          <a
            href="/api/connections/withings"
            className="rounded-full bg-teal-400 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-teal-300"
          >
            Connect
          </a>
        ) : (
          <span className="rounded bg-white/5 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-white/50">
            Set WITHINGS_CLIENT_ID
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
    </div>
  );
}
