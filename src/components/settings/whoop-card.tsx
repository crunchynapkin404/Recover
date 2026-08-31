"use client";

import { useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
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
  mechanismNoteId,
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
  // Sync and Disconnect share one transition flag; without a name, both would
  // announce themselves while one works.
  const [busy, setBusy] = useState<string | null>(null);

  function run(action: string, fn: () => Promise<ActionResult>) {
    setBusy(action);
    startTransition(async () => {
      try {
        setResult(await fn());
      } finally {
        // finally, not a trailing call: an action that throws would otherwise
        // strand its button in the pending label for the rest of the session.
        setBusy(null);
      }
    });
  }

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
      // Only while it is genuinely connectable: with the client id unset
      // the action is a "Set X_CLIENT_ID" badge, and describing a redirect
      // the athlete cannot start would be worse than saying nothing.
      mechanism={!connection && configured ? "redirect" : null}
      status={status}
      actions={
        connection ? (
          <div className="flex gap-2">
            <PendingButton
              type="button"
              disabled={pending}
              pending={pending && busy === "sync"}
              onClick={() => run("sync", whoopSyncNow)}
              className={connectorPillClass}
            >
              Sync
            </PendingButton>
            <PendingButton
              type="button"
              disabled={pending}
              pending={pending && busy === "disconnect"}
              onClick={() => run("disconnect", whoopDisconnect)}
              className={connectorGhostClass}
            >
              Disconnect
            </PendingButton>
          </div>
        ) : configured ? (
          <a
            href="/api/connections/whoop"
            aria-describedby={mechanismNoteId("Whoop")}
            className={connectorCtaClass}
          >
            Connect
          </a>
        ) : (
          <span className={connectorBadgeClass}>Set WHOOP_CLIENT_ID</span>
        )
      }
    />
  );
}
