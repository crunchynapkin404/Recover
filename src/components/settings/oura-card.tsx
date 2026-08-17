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
      // DOM POSITION (documentation gap closed, whole-branch review fix
      // wave, 2026-08-17). Before this card moved onto the shared shell
      // (df82880, "only the chrome moved… Still no class changes"), this
      // card rendered its own `<p role="status">` LAST — after the token
      // form and its help text (form → help <p> → status <p>). The shell
      // renders `status` before `{children}` (connector-card.tsx), so this
      // paragraph now lands FIRST: a failed token connect announces above
      // the input it refers to, rather than below the help text that
      // explains it. df82880's commit message never ruled on this move for
      // Oura specifically — it only asserted no *class* changed, which is
      // true and beside the point. Apple Health's identical question (does
      // moving the status paragraph onto this prop change its DOM
      // position?) got a full written ruling — reviewed, traced through
      // both branches, confirmed neutral for that card — in task 4's fix
      // round (commit f974324, recorded in tests/type-scale-guard.test.ts's
      // "233 occurrences" entry). Oura's was never reviewed at all.
      //
      // KEPT, not reverted: `role="status"` survives the move — an
      // assistive-technology live region still announces the message
      // regardless of where it sits in the DOM — and the new position
      // matches all four other connector cards (Strava, Whoop, Withings,
      // Apple Health); Oura being the one holdout at the old position would
      // be the actual inconsistency.
      //
      // oura-card.test.tsx had no case for this: none of its four tests
      // rendered `connection: null` together with a message (the one test
      // with a message, "renders a lastError as a live region", passes a
      // non-null `connection`). Closed in this same fix wave — see "renders
      // a connect-failure message ... when disconnected" in that file.
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
