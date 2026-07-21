"use client";

import { useState, useTransition } from "react";
import {
  revokeSession,
  signOutOtherSessions,
} from "@/app/settings/session-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface SessionRow {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
}

interface Props {
  sessions: SessionRow[];
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function SessionsCard({ sessions }: Props) {
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const otherCount = sessions.filter((s) => !s.isCurrent).length;

  function handleRevoke(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const res = await revokeSession(id);
      setResult(res.message);
      setPendingId(null);
    });
  }

  function handleSignOutOthers() {
    setPendingId("__others__");
    startTransition(async () => {
      const res = await signOutOtherSessions();
      setResult(res.message);
      setPendingId(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Sessions</CardTitle>
        <CardDescription>
          Devices currently signed in to your account. If you don&apos;t
          recognize one, revoke it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {s.device}
                  {s.isCurrent && (
                    <Badge variant="secondary">This device</Badge>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">
                  {s.ipAddress ? `${s.ipAddress} · ` : ""}
                  Last active {formatWhen(s.updatedAt)} · Signed in{" "}
                  {formatWhen(s.createdAt)}
                </span>
              </div>
              {!s.isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(s.id)}
                  disabled={pending}
                  className="text-destructive shrink-0"
                >
                  {pending && pendingId === s.id ? "Revoking…" : "Revoke"}
                </Button>
              )}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No active sessions found.
            </p>
          )}
        </div>

        {otherCount > 0 && (
          <div className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOutOthers}
              disabled={pending}
              className="text-destructive"
            >
              {pending && pendingId === "__others__"
                ? "Signing out…"
                : `Sign out everywhere else (${otherCount})`}
            </Button>
            <p className="text-muted-foreground mt-1 text-xs">
              Ends every session except this one — this device stays signed in.
            </p>
          </div>
        )}

        {result && <p className="text-muted-foreground text-sm">{result}</p>}
      </CardContent>
    </Card>
  );
}
