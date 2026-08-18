"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { submitDebrief, skipDebrief } from "@/app/activity/debrief-actions";
import { useDictation } from "@/lib/use-dictation";

const FEELS = ["strong", "normal", "weak"] as const;

// The athlete's own words for the number they just picked.
const RPE_WORD: Record<number, string> = {
  1: "very easy",
  2: "easy",
  3: "easy",
  4: "steady",
  5: "steady",
  6: "moderate",
  7: "hard",
  8: "hard",
  9: "very hard",
  10: "max",
};

export interface DebriefSheetProps {
  activityId: string;
  activityName: string;
  /** "1:15 · 78 load · 32km" — only the metrics that exist. */
  metrics: string;
  prefillRpe: number | null;
  prefillFeel: (typeof FEELS)[number] | null;
  closeHref: string;
}

/**
 * Post-ride debrief (1i). Same submitDebrief / skipDebrief actions the
 * inline form uses — this is the sheet the push notification opens.
 *
 * Prefills from intervals.icu arrive selected; anything untouched submits
 * null, because the coach's review says "gave no feedback" rather than
 * inventing an RPE nobody entered.
 */
export function DebriefSheet({
  activityId,
  activityName,
  metrics,
  prefillRpe,
  prefillFeel,
  closeHref,
}: DebriefSheetProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rpe, setRpe] = useState<number | null>(prefillRpe);
  const [feel, setFeel] = useState<(typeof FEELS)[number] | null>(prefillFeel);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dictation = useDictation((chunk) =>
    setNotes((prev) => (prev ? `${prev} ${chunk}` : chunk))
  );

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.message ?? "Something went wrong.");
        return;
      }
      router.push(closeHref);
      router.refresh();
    });
  }

  return (
    <BottomSheet title={`How was ${activityName}?`} closeHref={closeHref}>
      <p className="-mt-2 mb-4 text-label leading-snug text-ink-secondary">
        Feeds the coach&apos;s ride review. Leave anything blank — nothing is
        invented from silence.
      </p>

      {metrics && (
        <p className="mb-4 rounded-xl border border-hairline bg-surface-selected px-3.5 py-2.5 font-mono text-label text-ink-secondary">
          {metrics}
        </p>
      )}

      <div role="group" aria-label="Perceived exertion 1 to 10">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
            RPE
          </span>
          <span className="text-label font-bold text-success-ink">
            {rpe == null ? "" : `${rpe}/10 — ${RPE_WORD[rpe]}`}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rpe === n}
              onClick={() => setRpe(rpe === n ? null : n)}
              className={`size-[29px] rounded-full text-label font-bold transition-colors ${
                rpe === n
                  ? "bg-accent text-accent-foreground"
                  : "bg-surface-selected text-ink-secondary"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4" role="group" aria-label="How did you feel">
        <span className="text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
          Feel
        </span>
        <div className="mt-2 flex gap-1.5">
          {FEELS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={feel === f}
              onClick={() => setFeel(feel === f ? null : f)}
              className={`rounded-full px-5 py-2 text-label font-bold capitalize transition-colors ${
                feel === f
                  ? "bg-success-tint text-success-ink"
                  : "bg-surface-selected text-ink-secondary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-hairline bg-surface-selected px-3.5 py-2.5">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything to note — pain, mood, conditions?"
          aria-label="Note"
          className="min-w-0 flex-1 bg-transparent text-label text-ink-primary outline-none placeholder:text-ink-muted"
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={dictation.toggle}
            aria-pressed={dictation.dictating}
            aria-label="Dictate note"
            className={`shrink-0 rounded-full p-1.5 transition-colors ${
              dictation.dictating
                ? "bg-success-tint text-success-ink"
                : "text-ink-muted"
            }`}
          >
            <Mic aria-hidden className="size-4" />
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-label text-destructive-ink">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() =>
              submitDebrief(activityId, {
                rpe,
                feel,
                notes: notes.trim() || null,
              })
            )
          }
          className="flex-1 rounded-full bg-accent py-3 text-caption font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save & get review"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => skipDebrief(activityId))}
          className="rounded-full border border-hairline bg-surface-selected px-6 py-3 text-caption font-semibold text-ink-secondary disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </BottomSheet>
  );
}
