"use client";

import { useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import { setBodyPrefs } from "@/app/settings/body-actions";

interface Props {
  wakeTime: string | null;
  sleepNeedSecs: number;
  maxHr: number | null;
  ftpWatts: number | null;
  ftpWattsIndoor: number | null;
  thresholdPaceSecPerKm: number | null;
  squatOneRmKg: number | null;
  benchOneRmKg: number | null;
  deadliftOneRmKg: number | null;
  overheadPressOneRmKg: number | null;
}

const inputClass =
  "w-full rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary";

export function BodyPrefsCard({
  wakeTime,
  sleepNeedSecs,
  maxHr,
  ftpWatts,
  ftpWattsIndoor,
  thresholdPaceSecPerKm,
  squatOneRmKg,
  benchOneRmKg,
  deadliftOneRmKg,
  overheadPressOneRmKg,
}: Props) {
  const [wake, setWake] = useState(wakeTime ?? "");
  const [hours, setHours] = useState((sleepNeedSecs / 3600).toString());
  const [hrMax, setHrMax] = useState(maxHr?.toString() ?? "");
  const [ftp, setFtp] = useState(ftpWatts?.toString() ?? "");
  const [ftpIndoor, setFtpIndoor] = useState(ftpWattsIndoor?.toString() ?? "");
  const [thresholdPace, setThresholdPace] = useState(
    thresholdPaceSecPerKm?.toString() ?? ""
  );
  const [squat, setSquat] = useState(squatOneRmKg?.toString() ?? "");
  const [bench, setBench] = useState(benchOneRmKg?.toString() ?? "");
  const [deadlift, setDeadlift] = useState(deadliftOneRmKg?.toString() ?? "");
  const [ohp, setOhp] = useState(overheadPressOneRmKg?.toString() ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await setBodyPrefs({
        wakeTime: wake || null,
        sleepNeedSecs: Math.round(Number(hours) * 3600),
        maxHr: hrMax.trim() ? Number(hrMax) : null,
        ftpWatts: ftp.trim() ? Number(ftp) : null,
        ftpWattsIndoor: ftpIndoor.trim() ? Number(ftpIndoor) : null,
        thresholdPaceSecPerKm: thresholdPace.trim()
          ? Number(thresholdPace)
          : null,
        squatOneRmKg: squat.trim() ? Number(squat) : null,
        benchOneRmKg: bench.trim() ? Number(bench) : null,
        deadliftOneRmKg: deadlift.trim() ? Number(deadlift) : null,
        overheadPressOneRmKg: ohp.trim() ? Number(ohp) : null,
      });
      setMessage(result.ok ? "Saved." : (result.message ?? "Failed."));
    });
  }

  return (
    <section className="glass rounded-[2rem] p-6 space-y-4">
      <div>
        <h2 className="text-caption font-bold">Sleep &amp; Energy</h2>
        <p className="mt-1 text-label text-ink-muted">
          Your wake time is the only way Recover can suggest a bedtime — it
          isn&apos;t in any connected data source. Leave it blank and no bedtime
          is shown.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="block">
          <label htmlFor="wake-time" className="label-micro mb-1 block">
            Usual wake time
          </label>
          <input
            id="wake-time"
            type="time"
            value={wake}
            onChange={(e) => setWake(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="block">
          <label htmlFor="sleep-target" className="label-micro mb-1 block">
            Sleep target (hours)
          </label>
          <input
            id="sleep-target"
            type="number"
            min={4}
            max={12}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <h2 className="text-caption font-bold">Training thresholds</h2>
        <p className="mt-1 text-label text-ink-muted">
          Max HR and FTP compute training load from heart rate or power when an
          activity has no provider load. Threshold pace does something different
          — it anchors race-demand estimates for running. Leave any of these
          blank and you still get a result: unlabeled sessions count as easy
          time, and running demand estimates fall back to a less confident
          figure built from your history.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="block">
          <label htmlFor="max-hr" className="label-micro mb-1 block">
            Max HR (bpm)
          </label>
          <input
            id="max-hr"
            type="number"
            min={100}
            max={230}
            value={hrMax}
            onChange={(e) => setHrMax(e.target.value)}
            placeholder="e.g. 185"
            className={inputClass}
          />
        </div>
        <div className="block">
          <label htmlFor="ftp-outdoor" className="label-micro mb-1 block">
            FTP (watts) — outdoor
          </label>
          <input
            id="ftp-outdoor"
            type="number"
            min={50}
            max={600}
            value={ftp}
            onChange={(e) => setFtp(e.target.value)}
            placeholder="e.g. 250"
            className={inputClass}
          />
        </div>
        <div className="block">
          <label htmlFor="ftp-indoor" className="label-micro mb-1 block">
            FTP (watts) — indoor (optional)
          </label>
          <input
            id="ftp-indoor"
            type="number"
            min={50}
            max={600}
            value={ftpIndoor}
            onChange={(e) => setFtpIndoor(e.target.value)}
            placeholder="e.g. 235"
            className={inputClass}
          />
        </div>
        <div className="block">
          <label htmlFor="threshold-pace" className="label-micro mb-1 block">
            Threshold pace (sec/km)
          </label>
          <input
            id="threshold-pace"
            type="number"
            min={150}
            max={600}
            value={thresholdPace}
            onChange={(e) => setThresholdPace(e.target.value)}
            placeholder="e.g. 285"
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-6">
        <span className="label-micro mb-1 block">Strength maxes</span>
        <p className="mb-3 text-caption text-ink-muted">
          Your one-rep max per lift, in kilograms. Setting these turns on
          planned strength sessions; a lift you leave blank still gets sets and
          reps, just no weight target.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div className="block">
          <label htmlFor="squat-1rm" className="label-micro mb-1 block">
            Squat 1RM (kg)
          </label>
          <input
            id="squat-1rm"
              type="number"
              min={10}
              max={400}
              value={squat}
              onChange={(e) => setSquat(e.target.value)}
              placeholder="e.g. 120"
              className={inputClass}
            />
          </div>
          <div className="block">
          <label htmlFor="bench-1rm" className="label-micro mb-1 block">
            Bench 1RM (kg)
          </label>
          <input
            id="bench-1rm"
              type="number"
              min={10}
              max={400}
              value={bench}
              onChange={(e) => setBench(e.target.value)}
              placeholder="e.g. 80"
              className={inputClass}
            />
          </div>
          <div className="block">
          <label htmlFor="deadlift-1rm" className="label-micro mb-1 block">
            Deadlift 1RM (kg)
          </label>
          <input
            id="deadlift-1rm"
              type="number"
              min={10}
              max={400}
              value={deadlift}
              onChange={(e) => setDeadlift(e.target.value)}
              placeholder="e.g. 150"
              className={inputClass}
            />
          </div>
          <div className="block">
          <label htmlFor="ohp-1rm" className="label-micro mb-1 block">
            Overhead press 1RM (kg)
          </label>
          <input
            id="ohp-1rm"
              type="number"
              min={10}
              max={400}
              value={ohp}
              onChange={(e) => setOhp(e.target.value)}
              placeholder="e.g. 50"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <PendingButton
          onClick={save}
          pending={pending}
          pendingLabel="Saving…"
          // bg-accent text-accent-foreground (whole-branch review fix wave,
          // 2026-08-17) — same fix, same reason, as notifications-card.tsx's
          // Enable button: was `bg-emerald-500 ... text-black`, a raw
          // palette fill neither guard sees (see that file's comment for
          // the full account). Dark's accent pair is visually
          // indistinguishable from the old emerald-500/black — not
          // byte-identical, as this comment read until v0.108.0: Tailwind v4
          // ships emerald-500 as oklch(69.6% 0.17 162.48), not #10b981.
          className="rounded-xl bg-accent px-4 py-2 text-caption font-bold text-accent-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          Save
        </PendingButton>
        {message && (
          <span className="text-label text-ink-muted">{message}</span>
        )}
      </div>
    </section>
  );
}
