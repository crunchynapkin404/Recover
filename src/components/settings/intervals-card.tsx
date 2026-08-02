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
            <Button type="submit" disabled={connecting}>
              {connecting ? "Validating…" : "Connect intervals.icu"}
            </Button>
          </form>
        )}

        {connection && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => setResult(await syncNow()))
              }
            >
              {pending ? "Syncing…" : "Sync now"}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () =>
                  setResult(await disconnectIntervals())
                )
              }
            >
              Disconnect
            </Button>
            <Button
              variant="outline"
              disabled={pending || connection.backfillRunning}
              onClick={() =>
                startTransition(async () => setResult(await backfillHistory()))
              }
            >
              {connection.backfillRunning
                ? "Backfilling…"
                : "Backfill full history"}
            </Button>
            <div className="flex items-center gap-2">
              <Label htmlFor="wellness-interval" className="text-xs">
                Wellness sync
              </Label>
              <select
                id="wellness-interval"
                className="h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm"
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
              <span className="text-[10px] text-white/40">
                Wellness checked:{" "}
                {new Date(connection.lastWellnessPollAt).toLocaleTimeString()}
              </span>
            )}
            {connection.lastSyncAt && (
              <span className="text-sm text-muted-foreground">
                Last sync: {new Date(connection.lastSyncAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {connection?.lastError && (
          <p className="text-sm text-destructive">
            Last error: {connection.lastError}
          </p>
        )}
        {message && (
          <p
            role="status"
            className={`text-sm ${messageOk ? "text-muted-foreground" : "text-destructive"}`}
          >
            {message}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted-foreground">
          Your API key is stored encrypted (AES-256-GCM) and only used to read
          wellness and activity data.
        </p>
        <p className="text-xs text-muted-foreground">
          Backfilling fetches every wellness day intervals.icu holds for you,
          not just the last year. It runs in the background and takes a few
          minutes. Recovery scores may shift afterwards, because older history
          changes the baselines they are measured against.
        </p>
      </CardFooter>
    </Card>
  );
}
