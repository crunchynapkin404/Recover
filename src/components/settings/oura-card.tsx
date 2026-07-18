"use client";

import { useActionState, useState, useTransition } from "react";
import {
  connectOura,
  ouraDisconnect,
  ouraSyncNow,
  type ActionResult,
} from "@/app/settings/oura-actions";

interface Props {
  connection: {
    accountName: string;
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
  } | null;
}

export function OuraCard({ connection }: Props) {
  const [connectState, connectAction, connecting] = useActionState<
    ActionResult | null,
    FormData
  >(connectOura, null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const message = result?.message ?? connectState?.message;
  const messageOk = result?.ok ?? connectState?.ok;

  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10">
            <span aria-hidden className="text-base text-sky-300">
              ◍
            </span>
          </div>
          <div>
            <p className="text-sm font-bold">Oura</p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              {connection
                ? `Connected${connection.accountName ? ` · ${connection.accountName}` : ""}`
                : "Staged sleep, HRV, temperature"}
            </span>
          </div>
        </div>

        {connection && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await ouraSyncNow()))
              }
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {pending ? "…" : "Sync"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await ouraDisconnect()))
              }
              className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {!connection && (
        <form action={connectAction} className="mt-3 flex gap-2">
          <input
            name="token"
            type="password"
            placeholder="Personal access token"
            autoComplete="off"
            required
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
          <button
            type="submit"
            disabled={connecting}
            className="shrink-0 rounded-full bg-sky-400 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-sky-300 disabled:opacity-50"
          >
            {connecting ? "…" : "Connect"}
          </button>
        </form>
      )}

      {!connection && (
        <p className="mt-2 text-[10px] text-white/40">
          Create a token at cloud.ouraring.com → Personal Access Tokens. Stored
          encrypted (AES-256-GCM).
        </p>
      )}

      {(message || connection?.lastError) && (
        <p
          role="status"
          className={`mt-3 text-xs ${
            (messageOk ?? false) ? "text-white/60" : "text-red-400"
          }`}
        >
          {message ?? `Last error: ${connection?.lastError}`}
        </p>
      )}
    </div>
  );
}
