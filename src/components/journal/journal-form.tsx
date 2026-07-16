"use client";

import { useActionState, useState } from "react";
import { Flame, CheckCircle } from "lucide-react";
import { logWellness, type ActionResult } from "@/app/wellness/actions";
import { ALL_DAY_FLAGS, type DayFlag } from "@/lib/day-flags";

function localYmd(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

interface DayEntry {
  energy: number | null;
  soreness: number | null;
  stress: number | null;
  mood: string | null;
  tags: string[] | null;
  dayFlags: DayFlag[] | null;
  notes: string | null;
}

interface Props {
  syncedHrv: number | null;
  syncedRhr: number | null;
  syncedWeight: number | null;
  syncedSleepHours: number | null;
  /** Days in the last 7 with a journal entry (computed server-side). */
  streakDays: number;
  /** Existing entries keyed by YYYY-MM-DD for the calendar strip days. */
  entriesByDate: Record<string, DayEntry>;
  /** True when user has an active intervals.icu / Strava connection. */
  hasActiveConnection: boolean;
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
  syncedSleepHours,
  streakDays,
  entriesByDate,
  hasActiveConnection,
}: Props) {
  const [state, action, pending] = useActionState<
    ActionResult | null,
    FormData
  >(logWellness, null);

  const todayYmd = localYmd(new Date());
  const todayEntry = entriesByDate[todayYmd];

  const [selectedMood, setSelectedMood] = useState<number | null>(() => {
    if (!todayEntry?.mood) return null;
    return MOODS.findIndex((m) => m.label === todayEntry.mood);
  });
  // null = unanswered. Never default to a number: a submitted 7 the athlete
  // never gave is indistinguishable from a real 7 once it's in the database.
  const [energy, setEnergy] = useState<number | null>(
    todayEntry?.energy ?? null
  );
  const [soreness, setSoreness] = useState<number | null>(
    todayEntry?.soreness ?? null
  );
  const [stress, setStress] = useState<number | null>(
    todayEntry?.stress ?? null
  );
  const [activeTags, setActiveTags] = useState<Set<string>>(
    () => new Set(todayEntry?.tags ?? [])
  );
  const [dayFlags, setDayFlags] = useState<Set<DayFlag>>(
    () => new Set(todayEntry?.dayFlags ?? [])
  );
  const [notes, setNotes] = useState(todayEntry?.notes ?? "");
  const [selectedDate, setSelectedDate] = useState(todayYmd);
  const [manualHrv, setManualHrv] = useState<string>("");
  const [manualRhr, setManualRhr] = useState<string>("");
  const [manualSleep, setManualSleep] = useState<string>("");
  const [manualWeight, setManualWeight] = useState<string>("");

  const toggleDayFlag = (flag: DayFlag) => {
    setDayFlags((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  };

  function switchDay(ymd: string) {
    setSelectedDate(ymd);
    const entry = entriesByDate[ymd];
    if (entry) {
      // A stored value shows as answered; its absence shows as unanswered.
      setEnergy(entry.energy ?? null);
      setSoreness(entry.soreness ?? null);
      setStress(entry.stress ?? null);
      setSelectedMood(
        entry.mood ? MOODS.findIndex((m) => m.label === entry.mood) : null
      );
      setActiveTags(new Set(entry.tags ?? []));
      setDayFlags(new Set(entry.dayFlags ?? []));
      setNotes(entry.notes ?? "");
    } else {
      // No entry for this day — everything unanswered
      setEnergy(null);
      setSoreness(null);
      setStress(null);
      setSelectedMood(null);
      setActiveTags(new Set());
      setDayFlags(new Set());
      setNotes("");
    }
    setManualHrv("");
    setManualRhr("");
    setManualSleep("");
    setManualWeight("");
  }

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
          const hasEntry = !!entriesByDate[d.ymd];
          return (
            <button
              key={d.ymd}
              type="button"
              onClick={() => switchDay(d.ymd)}
              aria-pressed={active}
              aria-label={`Log for ${d.label}${hasEntry ? " (logged)" : ""}`}
              className="flex min-w-[48px] flex-col items-center gap-2"
            >
              <span
                className={`text-[9px] font-bold uppercase ${active ? "text-emerald-400" : "text-white/50"}`}
              >
                {d.label}
              </span>
              <div
                className={`glass relative flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold ${
                  active
                    ? "text-white ring-2 ring-emerald-500 ring-offset-2 ring-offset-[#0a0a0a]"
                    : "text-white/50"
                }`}
              >
                {d.day}
                {hasEntry && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                )}
              </div>
            </button>
          );
        })}
      </section>

      <form action={action} className="space-y-3">
        <input type="hidden" name="date" value={selectedDate} />
        {/* "" when unanswered — the action's zod preprocess turns it into
            undefined and upsertWellness skips the field entirely. */}
        <input type="hidden" name="energy" value={energy ?? ""} />
        <input type="hidden" name="soreness" value={soreness ?? ""} />
        <input type="hidden" name="stress" value={stress ?? ""} />
        {/* Always submitted: clearing every flag means "a normal day". */}
        <input
          type="hidden"
          name="dayFlags"
          value={JSON.stringify([...dayFlags])}
        />
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
                [
                  "Energy",
                  energy,
                  setEnergy,
                  "text-emerald-400",
                  "Drained",
                  "Energized",
                  true,
                  7,
                ],
                [
                  "Muscle Soreness",
                  soreness,
                  setSoreness,
                  "text-amber-400",
                  "None",
                  "Very sore",
                  false,
                  4,
                ],
                [
                  "Stress",
                  stress,
                  setStress,
                  "text-sky-400",
                  "Calm",
                  "Overwhelmed",
                  false,
                  4,
                ],
              ] as const
            ).map(
              ([
                label,
                value,
                setter,
                color,
                lowLabel,
                highLabel,
                highIsGood,
                resting,
              ]) => (
                <div key={label} className="flex flex-col gap-2">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-white/80">
                      {label}
                    </span>
                    <span
                      className={`text-xs font-bold ${value == null ? "text-white/40" : color}`}
                    >
                      {value == null ? "—" : `${value}/10`}
                    </span>
                  </div>
                  {/* Unanswered sliders rest at a neutral position but submit
                      nothing. "Answered" is tracked on interaction, not on
                      value change: tapping exactly the resting value fires no
                      change event, so pointerdown/keydown commit it first and
                      change (if the thumb moved) overwrites with the real one.
                      pointerdown is guaranteed to precede input/change. */}
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={value ?? resting}
                    aria-label={
                      value == null
                        ? `${label}: not answered`
                        : `${label}: ${value} of 10`
                    }
                    onPointerDown={() => setter((v) => v ?? resting)}
                    onKeyDown={() => setter((v) => v ?? resting)}
                    onChange={(e) => setter(Number(e.target.value))}
                    className={`w-full accent-emerald-500 ${value == null ? "opacity-50" : ""}`}
                  />
                  <div className="flex justify-between">
                    <span
                      className={`text-[9px] font-medium ${!highIsGood ? "text-emerald-400/60" : "text-red-400/60"}`}
                    >
                      {lowLabel}
                    </span>
                    <span
                      className={`text-[9px] font-medium ${highIsGood ? "text-emerald-400/60" : "text-red-400/60"}`}
                    >
                      {highLabel}
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* Manual vitals — shown when no integration provides them automatically */}
        {!hasActiveConnection && (
          <div className="glass rounded-[2rem] p-6">
            <h3 className="label-micro mb-6">Today&apos;s Vitals</h3>
            <p className="mb-4 text-[10px] text-white/50">
              Enter your morning readings. Log HRV &amp; resting HR daily
              to unlock your readiness score after 14 days.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="manual-hrv" className="mb-1 block text-[10px] font-bold uppercase text-white/50">
                  HRV (ms)
                </label>
                <input
                  id="manual-hrv"
                  type="number"
                  name="hrvMs"
                  min={1}
                  max={300}
                  step={0.1}
                  value={manualHrv}
                  onChange={(e) => setManualHrv(e.target.value)}
                  placeholder="e.g. 55"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-400/50"
                />
              </div>
              <div>
                <label htmlFor="manual-rhr" className="mb-1 block text-[10px] font-bold uppercase text-white/50">
                  Resting HR (bpm)
                </label>
                <input
                  id="manual-rhr"
                  type="number"
                  name="restingHr"
                  min={20}
                  max={120}
                  step={1}
                  value={manualRhr}
                  onChange={(e) => setManualRhr(e.target.value)}
                  placeholder="e.g. 58"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-400/50"
                />
              </div>
              <div>
                <label htmlFor="manual-sleep" className="mb-1 block text-[10px] font-bold uppercase text-white/50">
                  Sleep (hours)
                </label>
                <input
                  id="manual-sleep"
                  type="number"
                  name="sleepHours"
                  min={0}
                  max={24}
                  step={0.25}
                  value={manualSleep}
                  onChange={(e) => setManualSleep(e.target.value)}
                  placeholder="e.g. 7.5"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-400/50"
                />
              </div>
              <div>
                <label htmlFor="manual-weight" className="mb-1 block text-[10px] font-bold uppercase text-white/50">
                  Weight (kg)
                </label>
                <input
                  id="manual-weight"
                  type="number"
                  name="weightKg"
                  min={20}
                  max={300}
                  step={0.1}
                  value={manualWeight}
                  onChange={(e) => setManualWeight(e.target.value)}
                  placeholder="e.g. 72"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-400/50"
                />
              </div>
            </div>
          </div>
        )}

        {/* Vitals auto-submitted from sync — no manual entry needed */}
        {syncedHrv != null && (
          <input type="hidden" name="hrvMs" value={syncedHrv.toFixed(0)} />
        )}
        {syncedRhr != null && (
          <input type="hidden" name="restingHr" value={syncedRhr.toFixed(0)} />
        )}
        {syncedWeight != null && (
          <input
            type="hidden"
            name="weightKg"
            value={syncedWeight.toFixed(1)}
          />
        )}
        {syncedSleepHours != null && (
          <input
            type="hidden"
            name="sleepHours"
            value={syncedSleepHours.toFixed(1)}
          />
        )}

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

        {/* Day flags — facts that invalidate the day as a baseline reference.
            Visually distinct from behavior tags above: a tag is a choice you
            want measured, a flag is a fact that discounts the measurement. */}
        <div className="glass rounded-[2rem] p-6">
          <h3 className="label-micro mb-4">Anything unusual today?</h3>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Day flags"
          >
            {ALL_DAY_FLAGS.map(({ key, emoji, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={dayFlags.has(key)}
                onClick={() => toggleDayFlag(key)}
                className={`glass flex items-center gap-1.5 rounded-full border-white/10 px-3 py-1.5 text-[10px] font-medium ${
                  dayFlags.has(key) ? "tag-active" : ""
                }`}
              >
                <span aria-hidden>{emoji}</span> {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-white/50">
            Flagged days still get a score — they&apos;re just left out of your
            baselines.
          </p>
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
