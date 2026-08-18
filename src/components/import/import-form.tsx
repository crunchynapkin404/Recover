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
        <h1 className="text-heading font-bold tracking-tighter">Import Data</h1>
        <p className="mt-1 text-label font-medium uppercase tracking-widest text-ink-secondary">
          Wellness or activity data from a CSV file
        </p>
      </header>

      {/* Tab selector */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleTabChange("wellness")}
          className={`rounded-full px-4 py-1.5 text-caption font-medium transition-colors ${
            tab === "wellness"
              ? "bg-accent text-accent-foreground"
              : "text-ink-secondary hover:text-ink-primary"
          }`}
        >
          Wellness
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("activities")}
          className={`rounded-full px-4 py-1.5 text-caption font-medium transition-colors ${
            tab === "activities"
              ? "bg-accent text-accent-foreground"
              : "text-ink-secondary hover:text-ink-primary"
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
            className="w-full cursor-pointer rounded-2xl border-2 border-dashed border-hairline bg-surface-selected p-8 text-center transition-colors hover:border-accent hover:bg-surface-overlay"
          >
            <Upload className="mx-auto mb-3 h-8 w-8 text-ink-secondary" />
            <p className="text-caption text-ink-secondary">
              {fileName ? fileName : "Drop a CSV file here or click to browse"}
            </p>
            {rowCount != null && (
              <p className="mt-1 text-label text-success-ink">
                {rowCount} data row{rowCount !== 1 ? "s" : ""} found
              </p>
            )}
            <p className="mt-2 text-label text-ink-secondary">Max 5 MB</p>
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
            <p className="mb-1.5 text-label font-medium uppercase tracking-wider text-ink-secondary">
              Expected columns
            </p>
            <code className="block rounded-xl bg-surface-selected p-3 text-label font-mono text-ink-secondary">
              {EXAMPLE_HEADERS[tab]}
            </code>
          </div>

          {/* Import button */}
          <button
            type="submit"
            disabled={pending || rowCount == null || rowCount === 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3 font-bold text-accent-foreground transition-all hover:opacity-90 disabled:opacity-50"
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
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-success-ink" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive-ink" />
            )}
            <div className="min-w-0">
              <p
                className={`text-caption font-medium ${state.ok ? "text-success-ink" : "text-destructive-ink"}`}
              >
                {state.message}
              </p>
              {state.errors.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {state.errors.map((err, i) => (
                    <li key={i} className="text-label text-ink-secondary">
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
