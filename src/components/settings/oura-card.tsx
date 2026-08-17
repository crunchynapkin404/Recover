"use client";

import { useActionState, useState, useTransition } from "react";
import {
  connectOura,
  ouraDisconnect,
  ouraSyncNow,
  type ActionResult,
} from "@/app/settings/oura-actions";
import {
  ConnectorCard,
  connectorPillClass,
  connectorGhostClass,
  connectorCtaClass,
} from "./connector-card";

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
    <ConnectorCard
      name="Oura"
      tone="oura"
      glyph="◍"
      subtitle={
        connection
          ? `Connected${connection.accountName ? ` · ${connection.accountName}` : ""}`
          : "Staged sleep, HRV, temperature"
      }
      status={
        message || connection?.lastError
          ? {
              ok: messageOk ?? false,
              message: message ?? `Last error: ${connection?.lastError}`,
            }
          : null
      }
      actions={
        connection ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await ouraSyncNow()))
              }
              className={connectorPillClass}
            >
              {pending ? "…" : "Sync"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await ouraDisconnect()))
              }
              className={connectorGhostClass}
            >
              Disconnect
            </button>
          </div>
        ) : null
      }
    >
      {!connection && (
        <form action={connectAction} className="mt-3 flex gap-2">
          <input
            name="token"
            type="password"
            placeholder="Personal access token"
            autoComplete="off"
            required
            className="min-w-0 flex-1 rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary"
          />
          <button
            type="submit"
            disabled={connecting}
            className={`${connectorCtaClass} shrink-0`}
          >
            {connecting ? "…" : "Connect"}
          </button>
        </form>
      )}
      {!connection && (
        <p className="mt-2 text-label text-ink-muted">
          Create a token at cloud.ouraring.com → Personal Access Tokens. Stored
          encrypted (AES-256-GCM).
        </p>
      )}
    </ConnectorCard>
  );
}
