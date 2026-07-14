"use client";

import { useActionState, useState } from "react";
import {
  saveLlmSettings,
  deleteLlmSettings,
  type LlmActionResult,
} from "@/app/settings/llm-actions";
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
  settings: {
    providerType: "anthropic" | "openai_compatible";
    model: string;
    baseUrl: string | null;
    hasKey: boolean;
  } | null;
}

export function LlmSettingsCard({ settings }: Props) {
  const [saveState, saveAction, saving] = useActionState<
    LlmActionResult | null,
    FormData
  >(saveLlmSettings, null);
  const [deleteResult, setDeleteResult] = useState<LlmActionResult | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [providerType, setProviderType] = useState<
    "anthropic" | "openai_compatible"
  >(settings?.providerType ?? "anthropic");

  const message = deleteResult?.message ?? saveState?.message;
  const messageOk = deleteResult?.ok ?? saveState?.ok;

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteLlmSettings();
    setDeleteResult(result);
    setDeleting(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>AI Coach</CardTitle>
          {settings && (
            <Badge variant="secondary">
              {settings.providerType === "anthropic"
                ? "Anthropic"
                : "OpenAI-compatible"}
            </Badge>
          )}
        </div>
        <CardDescription>
          {settings
            ? `Model: ${settings.model}. The coach uses your own key — it never leaves your server.`
            : "Add your own LLM key to enable the AI recovery coach. Supports Anthropic Claude or any OpenAI-compatible endpoint (Ollama, Together, etc)."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={saveAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="providerType">Provider</Label>
            <select
              id="providerType"
              name="providerType"
              value={providerType}
              onChange={(e) =>
                setProviderType(
                  e.target.value as "anthropic" | "openai_compatible"
                )
              }
              className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm"
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai_compatible">
                OpenAI-compatible (Ollama, etc)
              </option>
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              name="model"
              type="text"
              defaultValue={settings?.model ?? ""}
              placeholder={
                providerType === "anthropic"
                  ? "claude-sonnet-4-20250514"
                  : "llama3.1:8b"
              }
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apiKey">
              API Key{" "}
              {providerType === "openai_compatible" && (
                <span className="text-muted-foreground text-xs">
                  (optional for Ollama)
                </span>
              )}
            </Label>
            <Input
              id="apiKey"
              name="apiKey"
              type="password"
              placeholder={
                settings?.hasKey ? "••••••• (unchanged if blank)" : "sk-ant-…"
              }
              autoComplete="off"
              required={providerType === "anthropic" && !settings?.hasKey}
            />
          </div>

          {providerType === "openai_compatible" && (
            <div className="grid gap-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                name="baseUrl"
                type="url"
                defaultValue={settings?.baseUrl ?? ""}
                placeholder="http://localhost:11434/v1"
              />
            </div>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </CardContent>

      {(message || settings) && (
        <CardFooter className="flex flex-col items-start gap-2">
          {message && (
            <p
              className={`text-sm ${messageOk ? "text-green-600" : "text-destructive"}`}
            >
              {message}
            </p>
          )}
          {settings && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="text-destructive"
            >
              {deleting ? "Removing…" : "Remove AI settings"}
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
