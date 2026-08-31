"use client";

import { useActionState, useState, useTransition } from "react";
import {
  connectIntervals,
  disconnectIntervals,
  syncNow,
  setWellnessPollInterval,
  backfillHistory,
  type ActionResult,
} from "@/app/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  connection: {
    athleteName: string;
    status: "active" | "error" | "revoked";
    lastSyncAt: string | null;
    lastError: string | null;
    /** null = app default (30). 0 = daily sync only. */
    wellnessPollIntervalMin: number | null;
    lastWellnessPollAt: string | null;
    /** A backfill job is pending or running for this user right now. */
    backfillRunning: boolean;
  } | null;
}

export function IntervalsCard({ connection }: Props) {
  const [connectState, connectAction, connecting] = useActionState<
    ActionResult | null,
    FormData
  >(connectIntervals, null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Which of the three actions is running. They share one transition flag, so
  // without this all three buttons would announce themselves while one works
  // — the per-item shape sessions-card established.
  const [busy, setBusy] = useState<string | null>(null);

  /** Runs `fn` as the named action, so only its own button says so. */
  function run(name: string, fn: () => Promise<typeof result>) {
    setBusy(name);
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

  const message = result?.message ?? connectState?.message;
  const messageOk = result?.ok ?? connectState?.ok;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>intervals.icu</CardTitle>
          {connection && (
            <Badge
              variant={
                connection.status === "active" ? "secondary" : "destructive"
              }
            >
              {connection.status === "active" ? "Connected" : connection.status}
            </Badge>
          )}
        </div>
        <CardDescription>
          {connection
            ? `Connected as ${connection.athleteName}. Wellness (HRV, resting HR, sleep) and activities sync from here.`
            : "Recover pulls your wellness and activities from intervals.icu. Find your API key under intervals.icu → Settings → Developer."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!connection && (
          <form action={connectAction} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                placeholder="e.g. 1a2b3c4d5e6f…"
                autoComplete="off"
                required
              />
            </div>
            <Button
              type="submit"
              pending={connecting}
              pendingLabel="Validating…"
            >
              Connect intervals.icu
            </Button>
          </form>
        )}

        {connection && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={pending}
              pending={pending && busy === "sync"}
              pendingLabel="Syncing…"
              onClick={() => run("sync", syncNow)}
            >
              Sync now
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              pending={pending && busy === "disconnect"}
              onClick={() => run("disconnect", disconnectIntervals)}
            >
              Disconnect
            </Button>
            <Button
              variant="outline"
              disabled={pending || connection.backfillRunning}
              pending={pending && busy === "backfill"}
              onClick={() => run("backfill", backfillHistory)}
              // Explicit, because the idle label is already "Backfilling…"
              // when the SERVER has a backfill running — the default would
              // append a second ellipsis to it.
              pendingLabel="Starting backfill…"
            >
              {connection.backfillRunning
                ? "Backfilling…"
                : "Backfill full history"}
            </Button>
            <div className="flex items-center gap-2">
              <Label htmlFor="wellness-interval" className="text-label">
                Wellness sync
              </Label>
              <select
                id="wellness-interval"
                className="h-9 rounded-md border border-hairline bg-transparent px-2 text-caption"
                defaultValue={String(connection.wellnessPollIntervalMin ?? 30)}
                disabled={pending}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  startTransition(async () =>
                    setResult(await setWellnessPollInterval(minutes))
                  );
                }}
              >
                <option value="0">Daily only</option>
                <option value="60">Every 60 min</option>
                <option value="30">Every 30 min</option>
                <option value="15">Every 15 min</option>
              </select>
            </div>
            {connection.lastWellnessPollAt && (
              <span className="text-label text-ink-muted">
                Wellness checked:{" "}
                {new Date(connection.lastWellnessPollAt).toLocaleTimeString()}
              </span>
            )}
            {connection.lastSyncAt && (
              <span className="text-caption text-muted-foreground">
                Last sync: {new Date(connection.lastSyncAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {connection?.lastError && (
          <p className="text-caption text-destructive">
            Last error: {connection.lastError}
          </p>
        )}
        {message && (
          <p
            role="status"
            className={`text-caption ${messageOk ? "text-muted-foreground" : "text-destructive"}`}
          >
            {message}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2">
        <p className="text-label text-muted-foreground">
          Your API key is stored encrypted (AES-256-GCM) and only used to read
          wellness and activity data.
        </p>
        <p className="text-label text-muted-foreground">
          Backfilling fetches your full wellness history from intervals.icu, not
          just the last year — it skips years where intervals.icu has no real
          data of yours, just its own calculated fitness numbers. It runs in the
          background and takes a few minutes. Recovery scores may shift
          afterwards, because older history changes the baselines they are
          measured against.
        </p>
      </CardFooter>
    </Card>
  );
}
