"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createApiToken,
  revokeApiToken,
  type TokenActionResult,
} from "@/app/settings/token-actions";
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

interface TokenRow {
  id: string;
  label: string;
  scopes: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Props {
  tokens: TokenRow[];
}

export function ApiTokensCard({ tokens }: Props) {
  const [createState, createAction, creating] = useActionState<
    TokenActionResult | null,
    FormData
  >(createApiToken, null);
  const [revoking, startRevoke] = useTransition();
  const [revokeResult, setRevokeResult] = useState<string | null>(null);
  const [showToken, setShowToken] = useState<string | null>(null);

  // Show the newly created token
  if (createState?.ok && createState.token && showToken !== createState.token) {
    setShowToken(createState.token);
  }

  function handleRevoke(tokenId: string) {
    startRevoke(async () => {
      const result = await revokeApiToken(tokenId);
      setRevokeResult(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP API Tokens</CardTitle>
        <CardDescription>
          Tokens for accessing your data via the MCP endpoint (Claude Desktop,
          Claude Code, etc). Each token is shown once on creation.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Existing tokens */}
        {tokens.length > 0 && (
          <div className="grid gap-2">
            {tokens.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div>
                  <span className="text-caption font-medium">{t.label}</span>
                  <span className="text-muted-foreground ml-2 text-label">
                    {t.scopes}
                  </span>
                  {t.lastUsedAt && (
                    <span className="text-muted-foreground ml-2 text-label">
                      · last used {new Date(t.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(t.id)}
                  disabled={revoking}
                  className="text-destructive"
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Newly created token display. `bg-success-tint` + `border-hairline`
            (whole-branch review fix wave, 2026-08-17): this was hand-rolling
            its own per-theme green pair (`border-green-200 bg-green-50
            dark:border-green-800 dark:bg-green-950`) right next to
            `text-success-ink`, which Task 8b had already minted a real
            token for — the exact anti-pattern that token's own comment in
            globals.css argues against. `border-hairline` rather than
            dropping the border: the box already carried one before this
            fix, and the same idiom (border-hairline around a tinted/raised
            block) is what the webhook-URL reveal in apple-health-card.tsx
            and the secret reveal in webhooks-card.tsx use for the identical
            "copy this now" case, so this now reads as one language across
            all three instead of three bespoke treatments. */}
        {showToken && (
          <div className="rounded-md border border-hairline bg-success-tint p-3">
            <p className="mb-1 text-caption font-medium text-success-ink">
              Copy this token now — it won&apos;t be shown again:
            </p>
            <code className="block break-all rounded bg-surface-raised px-2 py-1 text-label">
              {showToken}
            </code>
          </div>
        )}

        {/* Create new token */}
        <form action={createAction} className="grid gap-3 border-t pt-3">
          <div className="grid gap-2">
            <Label htmlFor="tokenLabel">Label</Label>
            <Input
              id="tokenLabel"
              name="label"
              type="text"
              placeholder="e.g. Claude Desktop"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tokenScopes">Scopes</Label>
            <select
              id="tokenScopes"
              name="scopes"
              className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-caption"
            >
              <option value="read">Read only</option>
              <option value="read|write:wellness">Read + write wellness</option>
              <option value="read|write:wellness|write:plan|write:memory">
                Read + write wellness, plans &amp; memory
              </option>
              <option value="read|write:icu">
                Write to intervals.icu (calendar, wellness, activities)
              </option>
              <option value="read|write:wellness|write:plan|write:memory|write:strava|write:icu">
                Full access (incl. Strava descriptions &amp; intervals.icu)
              </option>
            </select>
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create token"}
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
