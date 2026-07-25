"use client";

import { formatAvailability } from "@/lib/week-plan/availability";
import { WheelColumn } from "./wheel-column";

const PRESETS = [0, 30, 45, 60, 90, 120, 150];
const HOURS = Array.from({ length: 13 }, (_, i) => i); // 0..12
const MINUTES = [0, 15, 30, 45];

export interface AvailabilitySheetProps {
  dayLabel: string;
  mins: number;
  onChange: (mins: number) => void;
  onClose: () => void;
}

export function AvailabilitySheet({
  dayLabel,
  mins,
  onChange,
  onClose,
}: AvailabilitySheetProps) {
  const hours = Math.min(12, Math.floor(mins / 60));
  const minutes = hours === 12 ? 0 : mins % 60;

  function setHours(h: number) {
    onChange(h === 12 ? 720 : h * 60 + minutes);
  }
  function setMinutes(m: number) {
    onChange(hours * 60 + m);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={dayLabel}
        className="relative w-full max-w-lg rounded-t-[28px] border border-white/[0.12] bg-[#111113] px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3"
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20"
        />
        <h2 className="mb-4 text-[16px] font-bold tracking-[-0.02em]">
          {dayLabel}
        </h2>

        <div className="mb-5 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-bold ${
                mins === p
                  ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300"
                  : "border-white/10 bg-white/5 text-white/70"
              }`}
            >
              {formatAvailability(p)}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center gap-1 pb-2">
          <WheelColumn
            options={HOURS}
            value={hours}
            onChange={setHours}
            label="Hours"
          />
          <span className="text-white/40">h</span>
          <WheelColumn
            options={MINUTES}
            value={minutes}
            onChange={setMinutes}
            disabled={hours === 12}
            label="Minutes"
          />
          <span className="text-white/40">m</span>
        </div>
      </div>
    </div>
  );
}
