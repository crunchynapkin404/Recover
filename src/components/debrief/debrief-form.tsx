"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitDebrief, skipDebrief } from "@/app/activity/debrief-actions";

const FEELS = ["strong", "normal", "weak"] as const;

export function DebriefForm({
  activityId,
  activityName,
  prefillRpe,
  prefillFeel,
}: {
  activityId: string;
  activityName: string;
  prefillRpe: number | null;
  prefillFeel: (typeof FEELS)[number] | null;
}) {
  // Prefills (from intervals.icu) arrive as the initial selection; without a
  // prefill nothing is selected and an untouched control submits null.
  const [rpe, setRpe] = useState<number | null>(prefillRpe);
  const [feel, setFeel] = useState<(typeof FEELS)[number] | null>(prefillFeel);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.message ?? "Something went wrong.");
      else router.refresh();
    });
  }

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="text-sm font-semibold text-white">
        How was {activityName}?
      </h3>
      <p className="mt-1 text-xs text-white/50">
        Your answer feeds the coach&apos;s ride review. Leave anything blank —
        nothing is invented from silence.
      </p>

      <div
        className="mt-4"
        role="group"
        aria-label="Perceived exertion 1 to 10"
      >
        <span className="text-xs text-white/60">
          RPE {rpe == null ? "(not set)" : `${rpe}/10`}
        </span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rpe === n}
              onClick={() => setRpe(rpe === n ? null : n)}
              className={`h-8 w-8 rounded-full text-xs font-bold transition-colors ${
                rpe === n
                  ? "bg-emerald-500 text-black"
                  : "bg-white/5 text-white/60"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4" role="group" aria-label="How did you feel">
        <span className="text-xs text-white/60">
          Feel {feel == null ? "(not set)" : `(${feel})`}
        </span>
        <div className="mt-2 flex gap-2">
          {FEELS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={feel === f}
              onClick={() => setFeel(feel === f ? null : f)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition-colors ${
                feel === f
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/5 text-white/60"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything to note — pain, mood, conditions?"
        rows={2}
        className="mt-4 w-full rounded-2xl border border-white/8 bg-white/3 p-3 text-sm text-white outline-none placeholder:text-white/40"
      />

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-4 flex gap-2">
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
          className="rounded-full bg-emerald-500 px-5 py-2 text-xs font-bold text-black disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save & get review"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => skipDebrief(activityId))}
          className="rounded-full bg-white/5 px-5 py-2 text-xs font-semibold text-white/60 disabled:opacity-40"
        >
          Skip
        </button>
      </div>
    </section>
  );
}
