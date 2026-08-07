"use client";

import { useState, useTransition } from "react";
import { setBodyPrefs } from "@/app/settings/body-actions";

interface Props {
  wakeTime: string | null;
  sleepNeedSecs: number;
  maxHr: number | null;
  ftpWatts: number | null;
  thresholdPaceSecPerKm: number | null;
}

export function BodyPrefsCard({
  wakeTime,
  sleepNeedSecs,
  maxHr,
  ftpWatts,
  thresholdPaceSecPerKm,
}: Props) {
  const [wake, setWake] = useState(wakeTime ?? "");
  const [hours, setHours] = useState((sleepNeedSecs / 3600).toString());
  const [hrMax, setHrMax] = useState(maxHr?.toString() ?? "");
  const [ftp, setFtp] = useState(ftpWatts?.toString() ?? "");
  const [thresholdPace, setThresholdPace] = useState(
    thresholdPaceSecPerKm?.toString() ?? ""
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await setBodyPrefs({
        wakeTime: wake || null,
        sleepNeedSecs: Math.round(Number(hours) * 3600),
        maxHr: hrMax.trim() ? Number(hrMax) : null,
        ftpWatts: ftp.trim() ? Number(ftp) : null,
        thresholdPaceSecPerKm: thresholdPace.trim()
          ? Number(thresholdPace)
          : null,
      });
      setMessage(result.ok ? "Saved." : (result.message ?? "Failed."));
    });
  }

  return (
    <section className="glass rounded-[2rem] p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold">Sleep &amp; Energy</h2>
        <p className="mt-1 text-[12px] text-white/50">
          Your wake time is the only way Recover can suggest a bedtime — it
          isn&apos;t in any connected data source. Leave it blank and no bedtime
          is shown.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="label-micro mb-1 block">Usual wake time</span>
          <input
            type="time"
            value={wake}
            onChange={(e) => setWake(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="label-micro mb-1 block">Sleep target (hours)</span>
          <input
            type="number"
            min={4}
            max={12}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <div>
        <h2 className="text-sm font-bold">Training thresholds</h2>
        <p className="mt-1 text-[12px] text-white/50">
          Max HR and FTP compute training load from heart rate or power when
          an activity has no provider load. Threshold pace does something
          different — it anchors race-demand estimates for running. Leave
          any of these blank and you still get a result: unlabeled sessions
          count as easy time, and running demand estimates fall back to a
          less confident figure built from your history.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <label className="block">
          <span className="label-micro mb-1 block">Max HR (bpm)</span>
          <input
            type="number"
            min={100}
            max={230}
            value={hrMax}
            onChange={(e) => setHrMax(e.target.value)}
            placeholder="e.g. 185"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="label-micro mb-1 block">FTP (watts)</span>
          <input
            type="number"
            min={50}
            max={600}
            value={ftp}
            onChange={(e) => setFtp(e.target.value)}
            placeholder="e.g. 250"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="label-micro mb-1 block">Threshold pace (sec/km)</span>
          <input
            type="number"
            min={150}
            max={600}
            value={thresholdPace}
            onChange={(e) => setThresholdPace(e.target.value)}
            placeholder="e.g. 285"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {message && (
          <span className="text-[12px] text-white/60">{message}</span>
        )}
      </div>
    </section>
  );
}
