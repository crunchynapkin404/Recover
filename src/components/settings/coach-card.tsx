"use client";

import { startTransition, useActionState, useState } from "react";
import {
  deleteMemoryAction,
  saveCoachSettings,
  updateMemoryAction,
} from "@/app/settings/coach-actions";
import type { LlmActionResult } from "@/app/settings/llm-actions";
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
import { SUPPORTED_COACH_LANGUAGES } from "@/lib/coach-persona";

export interface CoachMemoryItem {
  id: string;
  category: string;
  content: string;
}

interface Props {
  configured: boolean;
  personality: "analytical" | "encouraging" | "direct";
  language: string;
  memories: CoachMemoryItem[];
}

export function CoachCard({
  configured,
  personality,
  language,
  memories,
}: Props) {
  const [saveState, saveAction, saving] = useActionState<
    LlmActionResult | null,
    FormData
  >(saveCoachSettings, null);
  // Controlled, not defaultValue: React resets uncontrolled form fields to
  // their defaultValue after every action submit, which snapped these back
  // to whatever was loaded at page-mount regardless of what was just saved
  // (a real production bug — the save always persisted, the dropdown just
  // never showed it without a hard reload).
  const [personalityValue, setPersonalityValue] = useState(personality);
  const [languageValue, setLanguageValue] = useState(language);
  const [rows, setRows] = useState(memories);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [rowMessage, setRowMessage] = useState<LlmActionResult | null>(null);

  const message = rowMessage?.message ?? saveState?.message;
  const messageOk = rowMessage?.ok ?? saveState?.ok;

  async function handleDelete(id: string) {
    const result = await deleteMemoryAction(id);
    setRowMessage(result);
    if (result.ok) setRows((r) => r.filter((m) => m.id !== id));
  }

  async function handleSaveEdit(id: string) {
    const result = await updateMemoryAction(id, draft);
    setRowMessage(result);
    if (result.ok) {
      setRows((r) =>
        r.map((m) => (m.id === id ? { ...m, content: draft.trim() } : m))
      );
      setEditingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Coach Personality & Memory</CardTitle>
          <Badge variant="secondary">{rows.length}/50 memories</Badge>
        </div>
        <CardDescription>
          Pick how the coach talks to you, and review what it remembers.
          Memories are saved when you tell the coach something durable — or
          removed here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Not action={saveAction}: React's form-action submission path
            // calls the DOM's native form.reset() once the action settles,
            // which snaps every <select> back to whichever <option> has no
            // explicit HTML `selected` — the FIRST option in the list, not
            // whatever was just saved. Controlled value/onChange alone does
            // NOT exempt a field from this (verified: it still reset even
            // fully controlled). Submitting imperatively, outside the
            // action-prop pathway, avoids the native reset entirely.
            const fd = new FormData();
            fd.set("personality", personalityValue);
            fd.set("language", languageValue);
            startTransition(() => saveAction(fd));
          }}
          className="grid gap-2"
        >
          <Label htmlFor="personality">Personality</Label>
          <div className="flex gap-2">
            <select
              id="personality"
              name="personality"
              value={personalityValue}
              onChange={(e) =>
                setPersonalityValue(
                  e.target.value as "analytical" | "encouraging" | "direct"
                )
              }
              className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-caption"
              disabled={!configured}
            >
              <option value="analytical">Analytical — numbers first</option>
              <option value="encouraging">Encouraging — warm (default)</option>
              <option value="direct">Direct — blunt and brief</option>
            </select>
            <Button type="submit" disabled={saving || !configured}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          {!configured && (
            <p className="text-muted-foreground text-label">
              Configure the AI coach above to enable personality and memory.
            </p>
          )}

          <Label htmlFor="language">Coaching language</Label>
          <select
            id="language"
            name="language"
            value={languageValue}
            onChange={(e) => setLanguageValue(e.target.value)}
            className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-caption"
            disabled={!configured}
          >
            {SUPPORTED_COACH_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </form>

        {rows.length > 0 && (
          <div className="grid gap-2">
            <Label>Memories</Label>
            <ul className="grid gap-2">
              {rows.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-caption"
                >
                  {editingId === m.id ? (
                    <>
                      <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleSaveEdit(m.id);
                          }
                        }}
                        maxLength={280}
                        autoFocus
                      />
                      <Button size="sm" onClick={() => handleSaveEdit(m.id)}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-muted-foreground mr-1 text-label uppercase">
                          {m.category}
                        </span>
                        {m.content}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(m.id);
                          setDraft(m.content);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => handleDelete(m.id)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      {message && (
        <CardFooter>
          <p
            className={`text-caption ${messageOk ? "text-green-600" : "text-destructive"}`}
          >
            {message}
          </p>
        </CardFooter>
      )}
    </Card>
  );
}
