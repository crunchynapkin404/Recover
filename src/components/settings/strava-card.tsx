"use client";

import { useEffect, useState, useTransition } from "react";
import {
  previewStravaDescription,
  setAutoDescribeStrava,
  setStravaDescriptionFields,
  stravaDisconnect,
  stravaSyncNow,
  type ActionResult,
} from "@/app/settings/strava-actions";
import {
  ALL_DESCRIPTION_FIELDS,
  type DescriptionField,
  type DescriptionFields,
} from "@/lib/strava-description-fields";
import {
  ConnectorCard,
  connectorPillClass,
  connectorGhostClass,
  connectorCtaClass,
  connectorBadgeClass,
  mechanismNoteId,
} from "./connector-card";

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
  descriptionFields: DescriptionFields;
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
  descriptionFields,
  errorParam,
}: Props) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [auto, setAuto] = useState(autoDescribe);
  // null config = every field on (v0.6 default) — expand it for the checkboxes.
  const [fields, setFields] = useState<Record<DescriptionField, boolean>>(
    () =>
      Object.fromEntries(
        ALL_DESCRIPTION_FIELDS.map((f) => [
          f.key,
          descriptionFields == null ? true : descriptionFields[f.key] === true,
        ])
      ) as Record<DescriptionField, boolean>
  );
  const [preview, setPreview] = useState<{
    text: string;
    sample: boolean;
  } | null>(null);

  const noneSelected = Object.values(fields).every((v) => !v);

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    previewStravaDescription(fields).then((p) => {
      if (!cancelled) setPreview(p);
    });
    return () => {
      cancelled = true;
    };
  }, [fields, auto]);

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
      name="Strava"
      tone="strava"
      glyph="↗"
      subtitle={
        connection
          ? `Connected as ${connection.athleteName}`
          : // What it brings, not whether it is on — the Connect pill beside
            // this line already says that, and the other four connectors all
            // name their data here. Accurate to src/lib/connectors/strava.ts,
            // which maps average_watts and average_heartrate off each
            // activity.
            "Activities, power, heart rate"
      }
      // Only while it is genuinely connectable: with the client id unset
      // the action is a "Set X_CLIENT_ID" badge, and describing a redirect
      // the athlete cannot start would be worse than saying nothing.
      mechanism={!connection && configured ? "redirect" : null}
      status={status}
      actions={
        connection ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await stravaSyncNow()))
              }
              className={connectorPillClass}
            >
              {pending ? "…" : "Sync"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await stravaDisconnect()))
              }
              className={connectorGhostClass}
            >
              Disconnect
            </button>
          </div>
        ) : configured ? (
          <a
            href="/api/connections/strava"
            aria-describedby={mechanismNoteId("Strava")}
            className={connectorCtaClass}
          >
            Connect
          </a>
        ) : (
          <span className={connectorBadgeClass}>Set STRAVA_CLIENT_ID</span>
        )
      }
    >
      {connection && !connection.writeEnabled && (
        // border-hairline bg-surface-overlay, not a token-for-token
        // colour swap (whole-branch review fix wave, 2026-08-17): this box
        // was `border-orange-500/20 bg-orange-500/10`, a raw palette fill
        // no guard sees, wrapped around a Reconnect CTA that already moved
        // to `bg-accent` in this same task. Orange has no home in this
        // design system's vocabulary — it isn't success, warning, or
        // destructive, and minting a token for one call site is out of
        // scope for a fix wave. More importantly, the box no longer earns
        // a second colour signal now that the CTA inside it is a solid
        // accent fill: two saturated, unrelated hues in one small row read
        // as competing alerts rather than one message, and
        // `connector-card.tsx`'s own history (Connect CTAs moved onto
        // --accent specifically so brand colour and action colour don't
        // compete — see globals.css's connector-tint comment) already
        // settled this the same way for the five connector chips. Neutral
        // `border-hairline bg-surface-overlay` groups the row exactly as
        // the old box did, without a second hue fighting the button.
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface-overlay p-3">
          <p className="text-label text-ink-secondary">
            Upgrade Strava connection for AI descriptions
          </p>
          <a
            href="/api/connections/strava"
            className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-label font-bold uppercase tracking-wider text-accent-foreground transition-colors hover:opacity-90"
          >
            Reconnect
          </a>
        </div>
      )}

      {connection?.writeEnabled && (
        <label className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-3 text-caption font-medium">
          <span className="flex flex-col">
            <span>Auto-describe new activities on Strava</span>
            <span className="text-label font-bold uppercase text-ink-muted">
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

      {connection?.writeEnabled && auto && (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="text-label font-bold uppercase tracking-wider text-ink-muted">
            Fields to include
          </p>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {ALL_DESCRIPTION_FIELDS.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-2 text-label text-ink-secondary"
              >
                <input
                  type="checkbox"
                  checked={fields[key]}
                  onChange={(e) => {
                    const next = { ...fields, [key]: e.target.checked };
                    setFields(next);
                    startTransition(() => setStravaDescriptionFields(next));
                  }}
                  className="h-4 w-4 shrink-0 accent-emerald-500"
                />
                {label}
              </label>
            ))}
          </div>

          {noneSelected ? (
            <p role="status" className="mt-3 text-label text-warning-ink">
              No fields selected — nothing will be published to Strava.
            </p>
          ) : (
            preview && (
              <div className="mt-3">
                <p className="text-label font-bold uppercase tracking-wider text-ink-muted">
                  Preview {preview.sample && "(example data)"}
                </p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-2xl border border-hairline bg-surface-base p-3 text-label text-ink-secondary">
                  {preview.text + "\n📊 Recover"}
                </pre>
              </div>
            )
          )}
        </div>
      )}

      <div className="mt-3 border-t border-hairline pt-3">
        <p className="text-label text-ink-muted">
          Powered by Strava. Strava data is shown here but{" "}
          <strong className="text-ink-secondary">
            never sent to the AI coach or MCP clients
          </strong>{" "}
          (Strava API terms).
        </p>
      </div>
    </ConnectorCard>
  );
}
