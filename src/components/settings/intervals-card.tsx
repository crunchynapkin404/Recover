"use client";

import { useActionState, useState, useTransition } from "react";
import {
  connectIntervals,
  disconnectIntervals,
  syncNow,
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
            <Badge variant={connection.status === "active" ? "secondary" : "destructive"}>
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
                startTransition(async () => setResult(await disconnectIntervals()))
              }
            >
              Disconnect
            </Button>
            {connection.lastSyncAt && (
              <span className="text-sm text-muted-foreground">
                Last sync: {new Date(connection.lastSyncAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {connection?.lastError && (
          <p className="text-sm text-destructive">Last error: {connection.lastError}</p>
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
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Your API key is stored encrypted (AES-256-GCM) and only used to read
          wellness and activity data.
        </p>
      </CardFooter>
    </Card>
  );
}
