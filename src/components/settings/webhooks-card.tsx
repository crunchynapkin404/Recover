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
}

interface Props {
  webhooks: WebhookRow[];
}

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: "readiness_computed", label: "Readiness computed (daily)" },
  { value: "band_changed", label: "Band changed" },
  { value: "backup_completed", label: "Backup completed" },
];

export function WebhooksCard({ webhooks }: Props) {
  const [createState, createAction, creating] = useActionState<
    WebhookActionResult | null,
    FormData
  >(createWebhookSubscription, null);
  const [revoking, startRevoke] = useTransition();
  const [revokeResult, setRevokeResult] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState<string | null>(null);

  // Show the newly created secret once.
  if (createState?.ok && createState.secret && showSecret !== createState.secret) {
    setShowSecret(createState.secret);
  }

  function handleRevoke(id: string) {
    startRevoke(async () => {
      const result = await revokeWebhookSubscription(id);
      setRevokeResult(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outbound Webhooks</CardTitle>
        <CardDescription>
          Signed HTTP POSTs to a URL of your choice on readiness, band, and
          backup events — wire this into Home Assistant, ntfy, or anything
          else listening. Each request carries an{" "}
          <code className="text-xs">x-recover-signature</code> header (HMAC-
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
                  <span className="break-all text-sm font-medium">
                    {w.url}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <Badge key={e} variant="outline">
                        {e}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(w.id)}
                  disabled={revoking}
                  className="text-destructive shrink-0"
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Newly created secret display */}
        {showSecret && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
            <p className="mb-1 text-sm font-medium text-green-800 dark:text-green-200">
              Copy this secret now — it won&apos;t be shown again:
            </p>
            <code className="block break-all rounded bg-white px-2 py-1 text-xs dark:bg-black">
              {showSecret}
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
                  className="flex items-center gap-2 text-sm"
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
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Add webhook"}
          </Button>
        </form>

        {/* Status messages */}
        {createState && !createState.ok && (
          <p className="text-destructive text-sm">{createState.message}</p>
        )}
        {revokeResult && (
          <p className="text-muted-foreground text-sm">{revokeResult}</p>
        )}
      </CardContent>
    </Card>
  );
}
