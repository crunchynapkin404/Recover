"use client";

import { useActionState, useRef, useState } from "react";
import { Upload, CheckCircle, AlertTriangle, FileUp } from "lucide-react";
import {
  importWellnessCSV,
  importActivityCSV,
  type ImportResult,
} from "@/app/import/actions";
import { EmptyState } from "@/components/ui/empty-state";

type Tab = "wellness" | "activities";

const EXAMPLE_HEADERS: Record<Tab, string> = {
  wellness:
    "date, hrv, resting_hr, sleep_hours, weight_kg, energy, soreness, stress",
  activities:
    "date, sport, name, duration_minutes, distance_km, load, avg_hr, avg_power, elevation_m",
};

export function ImportForm() {
  const [tab, setTab] = useState<Tab>("wellness");
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [wellnessState, wellnessAction, wellnessPending] = useActionState<
    ImportResult | null,
    FormData
  >(importWellnessCSV, null);

  const [activityState, activityAction, activityPending] = useActionState<
    ImportResult | null,
    FormData
  >(importActivityCSV, null);

  const state = tab === "wellness" ? wellnessState : activityState;
  const action = tab === "wellness" ? wellnessAction : activityAction;
  const pending = tab === "wellness" ? wellnessPending : activityPending;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setRowCount(null);
      setFileName(null);
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.trim());
      // Subtract 1 for header row
      setRowCount(Math.max(0, lines.length - 1));
    };
    reader.readAsText(file);
  }

  function handleTabChange(newTab: Tab) {
    setTab(newTab);
    setRowCount(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      <header className="mb-8 pt-8">
        <h1 className="text-2xl font-bold tracking-tighter">Import Data</h1>
        <p className="mt-1 text-xs font-medium uppercase tracking-widest text-white/50">
          Wellness or activity data from a CSV file
        </p>
      </header>

      {/* Tab selector */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleTabChange("wellness")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "wellness"
              ? "bg-emerald-500 text-black"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          Wellness
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("activities")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "activities"
              ? "bg-emerald-500 text-black"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          Activities
        </button>
      </div>

      <form ref={formRef} action={action}>
        <div className="glass rounded-[2rem] p-6 space-y-5">
          {/* Drop zone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full cursor-pointer rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.02] p-8 text-center transition-colors hover:border-emerald-400/50 hover:bg-white/[0.03]"
          >
            <Upload className="mx-auto mb-3 h-8 w-8 text-white/40" />
            <p className="text-sm text-white/70">
              {fileName ? fileName : "Drop a CSV file here or click to browse"}
            </p>
            {rowCount != null && (
              <p className="mt-1 text-xs text-emerald-400">
                {rowCount} data row{rowCount !== 1 ? "s" : ""} found
              </p>
            )}
            <p className="mt-2 text-[11px] text-white/30">Max 5 MB</p>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Example format hint */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/40">
              Expected columns
            </p>
            <code className="block rounded-xl bg-white/5 p-3 text-[11px] font-mono text-white/60">
              {EXAMPLE_HEADERS[tab]}
            </code>
          </div>

          {/* Import button */}
          <button
            type="submit"
            disabled={pending || rowCount == null || rowCount === 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 font-bold text-black transition-all hover:bg-emerald-400 disabled:opacity-50"
          >
            {pending
              ? "Importing…"
              : rowCount != null
                ? `Import ${rowCount} row${rowCount !== 1 ? "s" : ""}`
                : "Select a file"}
          </button>
        </div>
      </form>

      {/* Results */}
      {state ? (
        <div
          className={`glass rounded-[2rem] p-6 ${state.ok ? "border border-emerald-500/30" : "border border-red-500/30"}`}
        >
          <div className="flex items-start gap-3">
            {state.ok ? (
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            )}
            <div className="min-w-0">
              <p
                className={`text-sm font-medium ${state.ok ? "text-emerald-400" : "text-red-400"}`}
              >
                {state.message}
              </p>
              {state.errors.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {state.errors.map((err, i) => (
                    <li key={i} className="text-[11px] text-white/50">
                      {err}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={FileUp}
          message="Nothing imported yet. Choose a CSV to map columns."
        />
      )}
    </div>
  );
}
