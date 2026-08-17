"use client";

import { useState, useTransition } from "react";
import {
  whoopDisconnect,
  whoopSyncNow,
  type ActionResult,
} from "@/app/settings/whoop-actions";
import {
  ConnectorCard,
  connectorPillClass,
  connectorGhostClass,
  connectorCtaClass,
  connectorBadgeClass,
} from "./connector-card";

interface Props {
  configured: boolean; // WHOOP_CLIENT_ID/SECRET present server-side
  connection: {
    athleteName: string;
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
  } | null;
  errorParam?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: "You declined the Whoop authorization.",
  state_mismatch: "Sign-in state didn't match — try connecting again.",
  rejected: "Whoop rejected the app credentials. Check WHOOP_CLIENT_ID/SECRET.",
  failed: "Connecting to Whoop failed. Try again.",
};

export function WhoopCard({ configured, connection, errorParam }: Props) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const status =
    errorParam || result || connection?.lastError
      ? {
          ok: result?.ok ?? false,
          message:
            result?.message ??
            (errorParam ? ERROR_MESSAGES[errorParam] : null) ??
            `Last error: ${connection?.lastError}`,
        }
      : null;

  return (
    <ConnectorCard
      name="Whoop"
      tone="whoop"
      glyph="W"
      subtitle={
        connection
          ? `Connected as ${connection.athleteName}`
          : "Recovery, HRV, staged sleep"
      }
      status={status}
      actions={
        connection ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await whoopSyncNow()))
              }
              className={connectorPillClass}
            >
              {pending ? "…" : "Sync"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await whoopDisconnect()))
              }
              className={connectorGhostClass}
            >
              Disconnect
            </button>
          </div>
        ) : configured ? (
          <a href="/api/connections/whoop" className={connectorCtaClass}>
            Connect
          </a>
        ) : (
          <span className={connectorBadgeClass}>Set WHOOP_CLIENT_ID</span>
        )
      }
    />
  );
}
