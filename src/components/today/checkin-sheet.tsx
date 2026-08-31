"use client";

import { useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import { useRouter } from "next/navigation";
import { Mic } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { logWellness } from "@/app/wellness/actions";
import { useDictation } from "@/lib/use-dictation";

const EXTRA_TAGS = [
  "☕ Caffeine",
  "🍷 Alcohol",
  "💧 Hydration",
  "📱 Screen Time",
  "🧘 Meditation",
  "🧊 Cold Exposure",
  "💊 Creatine",
];

const SLIDERS = [
  { key: "energy", label: "Energy" },
  { key: "soreness", label: "Soreness" },
  { key: "stress", label: "Stress" },
] as const;

type SliderKey = (typeof SLIDERS)[number]["key"];

export interface CheckinSheetProps {
  /** Today, YYYY-MM-DD, resolved server-side in the athlete's own timezone. */
  date: string;
  /** "Tue Jul 22" for the sheet's corner. */
  dateLabel: string;
  /**
   * What already synced; null entries are simply not shown. `from` names the
   * day the readings came from when it isn't today — the strip must never
   * present yesterday's HRV as this morning's.
   */
  synced: {
    hrv: number | null;
    rhr: number | null;
    sleepClock: string | null;
    from: string | null;
  };
  /** The athlete's usual tags — pre-toggled, per the journal_prefs feature. */
  usualTags: string[];
  closeHref: string;
}

/**
 * Morning check-in (1h). The sixty-second version of the journal form: three
 * sliders, the tags the athlete usually ticks, and a note. It submits the
 * same logWellness action the full form does, so nothing about the record
 * differs — only how long it takes to write.
 *
 * Anything the athlete doesn't touch is submitted empty rather than
 * defaulted; a slider nobody moved is not a 5.
 */
export function CheckinSheet({
  date,
  dateLabel,
  synced,
  usualTags,
  closeHref,
}: CheckinSheetProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<SliderKey, number | null>>({
    energy: null,
    soreness: null,
    stress: null,
  });
  const [tags, setTags] = useState<Set<string>>(new Set(usualTags));
  const [showMore, setShowMore] = useState(false);
  const [notes, setNotes] = useState("");
  const dictation = useDictation((chunk) =>
    setNotes((prev) => (prev ? `${prev} ${chunk}` : chunk))
  );

  const syncedParts = [
    synced.hrv != null ? `HRV ${Math.round(synced.hrv)}` : null,
    synced.rhr != null ? `RHR ${Math.round(synced.rhr)}` : null,
    synced.sleepClock ? `sleep ${synced.sleepClock}` : null,
  ].filter(Boolean);

  const visibleTags = showMore
    ? [...new Set([...usualTags, ...EXTRA_TAGS])]
    : usualTags.length > 0
      ? usualTags
      : EXTRA_TAGS.slice(0, 5);

  function save() {
    setError(null);
    const form = new FormData();
    form.set("date", date);
    for (const s of SLIDERS) {
      const v = values[s.key];
      if (v != null) form.set(s.key, String(v));
    }
    for (const t of tags) form.append("tags", t);
    if (notes.trim()) form.set("notes", notes.trim());

    startTransition(async () => {
      const res = await logWellness(null, form);
      if (!res.ok) {
        setError(res.message ?? "Could not save the check-in.");
        return;
      }
      router.push(closeHref);
      router.refresh();
    });
  }

  return (
    <BottomSheet
      title="Morning check-in"
      subtitle={dateLabel}
      closeHref={closeHref}
    >
      {syncedParts.length > 0 && (
        <div
          className={`mb-4 flex flex-wrap items-baseline gap-x-2 rounded-xl border px-3.5 py-2.5 ${
            synced.from
              ? "border-hairline bg-surface-selected"
              : "border-accent/25 bg-success-tint"
          }`}
        >
          <span
            className={`text-label font-bold ${
              synced.from ? "text-ink-secondary" : "text-success-ink"
            }`}
          >
            {synced.from
              ? `Last synced ${new Date(synced.from + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : "✓ Synced"}
          </span>
          <span className="font-mono text-label text-ink-secondary">
            {syncedParts.join(" · ")}
          </span>
        </div>
      )}

      {SLIDERS.map((s) => {
        const v = values[s.key];
        return (
          <div key={s.key} className="mb-3.5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <label
                htmlFor={`checkin-${s.key}`}
                className="text-label font-semibold text-ink-primary"
              >
                {s.label}
              </label>
              <span
                className={`font-mono text-label font-bold ${
                  v == null
                    ? "text-ink-muted"
                    : v >= 6
                      ? "text-success-ink"
                      : "text-ink-secondary"
                }`}
              >
                {v ?? "—"}
              </span>
            </div>
            <input
              id={`checkin-${s.key}`}
              type="range"
              min={1}
              max={10}
              step={1}
              value={v ?? 5}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [s.key]: Number(e.target.value),
                }))
              }
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-selected accent-accent"
            />
          </div>
        );
      })}

      <p className="mb-2 mt-4 text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
        Yesterday&apos;s behaviors
        {usualTags.length > 0 && (
          <span className="ml-1.5 font-medium normal-case tracking-normal text-ink-muted">
            · usual pre-toggled
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visibleTags.map((t) => {
          const active = tags.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setTags((prev) => {
                  const next = new Set(prev);
                  if (next.has(t)) next.delete(t);
                  else next.add(t);
                  return next;
                })
              }
              className={`rounded-full border px-3 py-1.5 text-label font-semibold transition-colors ${
                active
                  ? "border-accent/50 bg-success-tint text-success-ink"
                  : "border-hairline bg-surface-selected text-ink-secondary"
              }`}
            >
              {t}
            </button>
          );
        })}
        {!showMore && (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="rounded-full border border-hairline bg-surface-selected px-3 py-1.5 text-label font-semibold text-ink-secondary"
          >
            + more
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-hairline bg-surface-selected px-3.5 py-2.5">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything to note?"
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
        <PendingButton
          type="button"
          pending={pending}
          pendingLabel="Saving…"
          onClick={save}
          className="flex-1 rounded-full bg-accent py-3 text-caption font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Save check-in
        </PendingButton>
        <button
          type="button"
          onClick={() => router.push(closeHref)}
          className="rounded-full border border-hairline bg-surface-selected px-6 py-3 text-caption font-semibold text-ink-secondary"
        >
          Skip
        </button>
      </div>
    </BottomSheet>
  );
}
