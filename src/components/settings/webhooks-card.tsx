"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createWebhookSubscription,
  revokeWebhookSubscription,
  type WebhookActionResult,
} from "@/app/settings/webhook-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
  lastDelivery: {
    status: "success" | "failed";
    attempts: number;
    at: string;
    lastError: string | null;
  } | null;
}

interface Props {
  webhooks: WebhookRow[];
}

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: "readiness_computed", label: "Readiness computed (daily)" },
  { value: "band_changed", label: "Band changed" },
  { value: "backup_completed", label: "Backup completed" },
];

/** Tiny local relative-time formatter — no existing helper in src/lib, and
 * this is the only place that needs one, so no new dependency. */
function formatAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function DeliveryStatus({
  lastDelivery,
}: {
  lastDelivery: WebhookRow["lastDelivery"];
}) {
  if (!lastDelivery) {
    return (
      <span className="text-muted-foreground text-label">
        No deliveries yet
      </span>
    );
  }

  if (lastDelivery.status === "success") {
    return (
      <span className="text-muted-foreground text-label">
        ✓ Delivered · {formatAgo(lastDelivery.at)}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-destructive text-label">
        Failed after {lastDelivery.attempts} attempt
        {lastDelivery.attempts === 1 ? "" : "s"} · {formatAgo(lastDelivery.at)}
      </span>
      {lastDelivery.lastError && (
        <span
          className="text-destructive line-clamp-1 text-label"
          title={lastDelivery.lastError}
        >
          {lastDelivery.lastError}
        </span>
      )}
    </div>
  );
}

export function WebhooksCard({ webhooks }: Props) {
  const [createState, createAction, creating] = useActionState<
    WebhookActionResult | null,
    FormData
  >(createWebhookSubscription, null);
  const [revoking, startRevoke] = useTransition();
  // Which row is being revoked, so only THAT button says so — the per-item
  // shape sessions-card established.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeResult, setRevokeResult] = useState<string | null>(null);

  const revealSecret = createState?.ok ? (createState.secret ?? null) : null;

  function handleRevoke(id: string) {
    setRevokingId(id);
    startRevoke(async () => {
      const result = await revokeWebhookSubscription(id);
      setRevokeResult(result.message);
      setRevokingId(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outbound Webhooks</CardTitle>
        <CardDescription>
          Signed HTTP POSTs to a URL of your choice on readiness, band, and
          backup events — wire this into Home Assistant, ntfy, or anything else
          listening. Each request carries an{" "}
          <code className="text-label">x-recover-signature</code> header (HMAC-
          SHA256 of the body, using the secret shown once below) so your
          receiver can verify it came from this server.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Existing webhooks */}
        {webhooks.length > 0 && (
          <div className="grid gap-2">
            {webhooks.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex flex-col gap-1">
                  <span className="break-all text-caption font-medium">
                    {w.url}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <Badge key={e} variant="outline">
                        {e}
                      </Badge>
                    ))}
                  </div>
                  <DeliveryStatus lastDelivery={w.lastDelivery} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(w.id)}
                  disabled={revoking}
                  pending={revoking && revokingId === w.id}
                  className="text-destructive shrink-0"
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Newly created secret display. `bg-success-tint` + `border-hairline`
            (whole-branch review fix wave, 2026-08-17): this was a dark-only
            alpha (`border-emerald-500/30 bg-emerald-500/10`) sitting right
            next to `text-success-ink`, which Task 8b had already minted a
            real token for. See the near-identical fix in api-tokens-card.tsx
            for why `border-hairline` stays rather than dropping the border —
            same "copy this now" shape, same idiom, one language across both. */}
        {revealSecret && (
          <div className="rounded-md border border-hairline bg-success-tint p-3">
            <p className="mb-1 text-caption font-medium text-success-ink">
              Copy this secret now — it won&apos;t be shown again:
            </p>
            <code className="block break-all rounded bg-surface-base px-2 py-1 text-label text-ink-secondary">
              {revealSecret}
            </code>
          </div>
        )}

        {/* Create new webhook */}
        <form action={createAction} className="grid gap-3 border-t pt-3">
          <div className="grid gap-2">
            <Label htmlFor="webhookUrl">URL</Label>
            <Input
              id="webhookUrl"
              name="url"
              type="url"
              placeholder="https://ntfy.example.com/recover"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label>Events</Label>
            <div className="grid gap-1.5">
              {EVENT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-caption"
                >
                  <input
                    type="checkbox"
                    name="events"
                    value={opt.value}
                    defaultChecked={opt.value === "readiness_computed"}
                    className="border-input size-4 rounded"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" pending={creating} pendingLabel="Creating…">
            Add webhook
          </Button>
        </form>

        {/* Status messages */}
        {createState && !createState.ok && (
          <p className="text-destructive text-caption">{createState.message}</p>
        )}
        {revokeResult && (
          <p className="text-muted-foreground text-caption">{revokeResult}</p>
        )}
      </CardContent>
    </Card>
  );
}
