"use client";

import { useActionState, useState } from "react";
import { Flame, CheckCircle } from "lucide-react";
import { logWellness, type ActionResult } from "@/app/wellness/actions";

function localYmd(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

interface Props {
  syncedHrv: number | null;
  syncedRhr: number | null;
  syncedWeight: number | null;
  /** Days in the last 7 with a journal entry (computed server-side). */
  streakDays: number;
}

const MOODS = [
  { emoji: "😊", label: "happy" },
  { emoji: "😐", label: "neutral" },
  { emoji: "😫", label: "exhausted" },
  { emoji: "🤕", label: "injured" },
  { emoji: "😴", label: "tired" },
] as const;

const BEHAVIOR_TAGS = [
  {
    group: "Lifestyle & Nutrition",
    tags: ["☕ Caffeine", "🍷 Alcohol", "💧 Hydration", "📱 Screen Time"],
  },
  {
    group: "Recovery & Supplements",
    tags: ["🧘 Meditation", "🧊 Cold Exposure", "💊 Creatine"],
  },
] as const;

export function JournalForm({
  syncedHrv,
  syncedRhr,
  syncedWeight,
  streakDays,
}: Props) {
  const [state, action, pending] = useActionState<
    ActionResult | null,
    FormData
  >(logWellness, null);
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState(7);
  const [soreness, setSoreness] = useState(4);
  const [stress, setStress] = useState(4);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState(localYmd(new Date()));

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // Calendar strip: the last 5 days are selectable log dates.
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (4 - i));
    return {
      ymd: localYmd(d),
      label:
        i === 4
          ? "Today"
          : d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
      day: d.getDate(),
    };
  });

  const streakClamped = Math.max(0, Math.min(7, streakDays));

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="mb-6 flex items-end justify-between pt-8">
        <div className="flex flex-col">
          <div className="mb-1 flex items-center gap-2">
            <Flame aria-hidden className="size-3.5 text-orange-500" />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
              Logging Streak
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tighter">
            Behavior Journal
          </h2>
        </div>
        <div
          role="img"
          aria-label={`Journal streak: ${streakClamped} of the last 7 days logged`}
          className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/10"
        >
          <svg className="-rotate-90 h-full w-full" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-white/5"
            />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="100"
              strokeDashoffset={100 - (streakClamped / 7) * 100}
              className="text-emerald-500"
            />
          </svg>
          <span className="absolute text-[8px] font-bold">
            {streakClamped}/7
          </span>
        </div>
      </header>

      {/* Calendar strip — selects which date the entry is for */}
      <section
        aria-label="Choose the day to log"
        className="hide-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 py-2"
      >
        {days.map((d) => {
          const active = selectedDate === d.ymd;
          return (
            <button
              key={d.ymd}
              type="button"
              onClick={() => setSelectedDate(d.ymd)}
              aria-pressed={active}
              aria-label={`Log for ${d.label}`}
              className="flex min-w-[48px] flex-col items-center gap-2"
            >
              <span
                className={`text-[9px] font-bold uppercase ${active ? "text-emerald-400" : "text-white/50"}`}
              >
                {d.label}
              </span>
              <div
                className={`glass flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold ${
                  active
                    ? "text-white ring-2 ring-emerald-500 ring-offset-2 ring-offset-[#0a0a0a]"
                    : "text-white/50"
                }`}
              >
                {d.day}
              </div>
            </button>
          );
        })}
      </section>

      <form action={action} className="space-y-3">
        <input type="hidden" name="date" value={selectedDate} />
        <input type="hidden" name="energy" value={energy} />
        <input type="hidden" name="soreness" value={soreness} />
        <input type="hidden" name="stress" value={stress} />
        <input
          type="hidden"
          name="mood"
          value={selectedMood != null ? MOODS[selectedMood].label : ""}
        />
        <input
          type="hidden"
          name="tags"
          value={activeTags.size > 0 ? JSON.stringify([...activeTags]) : ""}
        />

        {/* 1. Subjective feeling */}
        <div className="glass rounded-3xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="label-micro">1. Subjective Feeling</h3>
            {selectedMood != null && (
              <CheckCircle aria-hidden className="size-4 text-emerald-500" />
            )}
          </div>
          <div
            className="flex justify-between"
            role="radiogroup"
            aria-label="Mood"
          >
            {MOODS.map((mood, i) => (
              <button
                key={mood.label}
                type="button"
                role="radio"
                aria-checked={selectedMood === i}
                aria-label={`Mood: ${mood.label}`}
                onClick={() => setSelectedMood(selectedMood === i ? null : i)}
                className={`text-2xl transition-all ${
                  selectedMood === i
                    ? "rounded-full ring-2 ring-emerald-500 p-1"
                    : "grayscale hover:grayscale-0"
                }`}
              >
                <span aria-hidden>{mood.emoji}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Wellness sliders */}
        <div className="glass rounded-3xl p-5">
          <h3 className="label-micro mb-4">2. Wellness Sliders</h3>
          <div className="space-y-6">
            {(
              [
                ["Energy", energy, setEnergy, "text-emerald-400"],
                ["Muscle Soreness", soreness, setSoreness, "text-amber-400"],
                ["Stress", stress, setStress, "text-sky-400"],
              ] as const
            ).map(([label, value, setter, color]) => (
              <div key={label} className="flex flex-col gap-2">
                <div className="flex justify-between">
                  <span className="text-xs font-bold text-white/80">
                    {label}
                  </span>
                  <span className={`text-xs font-bold ${color}`}>
                    {value}/10
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={value}
                  aria-label={`${label}, 1 to 10`}
                  onChange={(e) => setter(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 3. Vitals */}
        <div className="glass rounded-3xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="label-micro">3. Vitals</h3>
            {(syncedHrv || syncedRhr) && (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-tighter text-emerald-500">
                intervals.icu synced
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["hrvMs", "HRV (ms)", syncedHrv?.toFixed(0)],
                ["restingHr", "RHR (bpm)", syncedRhr?.toFixed(0)],
                ["weightKg", "Weight (kg)", syncedWeight?.toFixed(1)],
                ["sleepHours", "Sleep (h)", undefined],
              ] as const
            ).map(([name, label, defaultValue]) => (
              <div key={name} className="flex flex-col gap-1">
                <label
                  htmlFor={`vital-${name}`}
                  className="text-[9px] font-bold uppercase text-white/50"
                >
                  {label}
                </label>
                <input
                  id={`vital-${name}`}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  name={name}
                  defaultValue={defaultValue ?? ""}
                  placeholder="—"
                  className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-sm font-bold text-white outline-none focus:border-emerald-500/40"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 4. Behavior tags */}
        <div className="glass rounded-[2rem] p-6">
          <h3 className="label-micro mb-6">Behavior Tags</h3>
          <div className="space-y-6">
            {BEHAVIOR_TAGS.map((group) => (
              <div key={group.group}>
                <h4 className="mb-3 text-[9px] font-bold uppercase text-white/50">
                  {group.group}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {group.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={activeTags.has(tag)}
                      onClick={() => toggleTag(tag)}
                      className={`glass flex items-center gap-1.5 rounded-full border-white/10 px-3 py-1.5 text-[10px] font-medium ${
                        activeTags.has(tag) ? "tag-active" : ""
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Notes */}
        <div className="glass rounded-[2rem] p-6">
          <div className="mb-4 flex items-center gap-2">
            <span aria-hidden className="text-emerald-400">
              ✏️
            </span>
            <label htmlFor="journal-notes" className="label-micro">
              Today&apos;s Notes
            </label>
          </div>
          <textarea
            id="journal-notes"
            name="notes"
            maxLength={2000}
            className="h-32 w-full resize-none bg-transparent text-sm leading-relaxed text-white/80 outline-none placeholder:text-white/40"
            placeholder="Anything on your mind — training, recovery, life..."
          />
        </div>

        {/* Submit */}
        {state && (
          <p
            role="status"
            className={`text-center text-sm ${state.ok ? "text-emerald-400" : "text-red-400"}`}
          >
            {state.message}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-2xl bg-emerald-500 py-4 font-bold text-black transition-all hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : `Save check-in for ${selectedDate}`}
        </button>
      </form>
    </div>
  );
}
