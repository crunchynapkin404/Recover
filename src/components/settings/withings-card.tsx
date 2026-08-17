"use client";

import { useState, useTransition } from "react";
import {
  withingsDisconnect,
  withingsSyncNow,
  type ActionResult,
} from "@/app/settings/withings-actions";
import {
  ConnectorCard,
  connectorPillClass,
  connectorGhostClass,
  connectorCtaClass,
  connectorBadgeClass,
} from "./connector-card";

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
      name="Withings"
      tone="withings"
      glyph="⚖"
      subtitle={
        connection ? "Connected" : "Weight, body composition, blood pressure"
      }
      status={status}
      actions={
        connection ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await withingsSyncNow()))
              }
              className={connectorPillClass}
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
              className={connectorGhostClass}
            >
              Disconnect
            </button>
          </div>
        ) : configured ? (
          <a href="/api/connections/withings" className={connectorCtaClass}>
            Connect
          </a>
        ) : (
          <span className={connectorBadgeClass}>Set WITHINGS_CLIENT_ID</span>
        )
      }
    />
  );
}
