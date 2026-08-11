"use client";

import { useActionState, useState, useTransition } from "react";
import {
  extractAction,
  saveBiomarkers,
  type ExtractResult,
  type SaveRow,
} from "@/app/health/actions";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Upload → extract → review → save (v0.13). Nothing is stored until the
 * athlete confirms the reviewed rows; per-value confidence is surfaced so
 * low-confidence extractions get a second look.
 */
export function HealthUpload() {
  const [state, action, extracting] = useActionState<
    ExtractResult | null,
    FormData
  >(extractAction, null);
  const [rows, setRows] = useState<SaveRow[] | null>(null);
  const [measuredAt, setMeasuredAt] = useState(todayYmd());
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // When a fresh extraction arrives, seed the editable review table.
  const extractedKey = state?.ok ? state.biomarkers.length : -1;
  const [seededKey, setSeededKey] = useState(-2);
  if (state?.ok && extractedKey !== seededKey && rows === null) {
    setSeededKey(extractedKey);
    setRows(
      state.biomarkers.map((b) => ({
        rawLabel: b.rawLabel,
        displayName: b.displayName,
        value: b.value,
        unit: b.unit,
        confidence: b.confidence,
      }))
    );
  }

  function update(i: number, patch: Partial<SaveRow>) {
    setRows((rs) =>
      rs ? rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : rs
    );
  }
  function remove(i: number) {
    setRows((rs) => (rs ? rs.filter((_, idx) => idx !== i) : rs));
  }

  function save() {
    if (!rows) return;
    startSave(async () => {
      const res = await saveBiomarkers(rows, measuredAt);
      setSaveMsg(res.message);
      if (res.ok) setRows(null);
    });
  }

  return (
    <div className="glass rounded-[2rem] p-6">
      <h2 className="text-sm font-bold">Add a blood test</h2>
      <p className="mt-1 text-[12px] text-white/50">
        Upload a PDF/photo or paste the values. They&apos;re extracted for you
        to review — nothing is saved until you confirm.
      </p>

      {!rows && (
        <form action={action} className="mt-4 space-y-3">
          <textarea
            name="text"
            rows={4}
            placeholder={"Paste lab values, e.g.\nLDL Cholesterol 95 mg/dL"}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
          <div className="flex items-center gap-2">
            <input
              type="file"
              name="file"
              accept="application/pdf,image/*"
              className="min-w-0 flex-1 text-xs text-white/60 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-[10px] file:font-bold file:uppercase file:tracking-wider file:text-white/80"
            />
            <button
              type="submit"
              disabled={extracting}
              className="shrink-0 rounded-full bg-emerald-500 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black disabled:opacity-50"
            >
              {extracting ? "Reading…" : "Extract"}
            </button>
          </div>
          {state && !state.ok && (
            <p role="status" className="text-xs text-red-400">
              {state.message}
            </p>
          )}
        </form>
      )}

      {rows && (
        <div className="mt-4">
          {state?.method === "text-parser" && (
            <p className="mb-2 text-[11px] text-amber-400">
              Parsed without a model — double-check the values.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-white/40">
                  <th className="pb-2 pr-2 font-bold">Marker</th>
                  <th className="pb-2 pr-2 font-bold">Value</th>
                  <th className="pb-2 pr-2 font-bold">Unit</th>
                  <th className="pb-2 pr-2 font-bold">Conf.</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-1 pr-2">
                      <input
                        value={r.displayName}
                        onChange={(e) =>
                          update(i, { displayName: e.target.value })
                        }
                        className="w-full rounded-lg bg-white/5 px-2 py-1 text-white"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        step="any"
                        value={r.value}
                        onChange={(e) =>
                          update(i, { value: Number(e.target.value) })
                        }
                        className="w-20 rounded-lg bg-white/5 px-2 py-1 text-white"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        value={r.unit ?? ""}
                        onChange={(e) =>
                          update(i, { unit: e.target.value || null })
                        }
                        className="w-20 rounded-lg bg-white/5 px-2 py-1 text-white"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <span
                        className={`text-xs tabular-nums ${
                          (r.confidence ?? 1) < 0.6
                            ? "text-amber-400"
                            : "text-white/50"
                        }`}
                      >
                        {r.confidence != null
                          ? `${Math.round(r.confidence * 100)}%`
                          : "—"}
                      </span>
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        aria-label="Remove row"
                        className="rounded px-2 py-1 text-xs text-white/40 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-white/60">
              Measured
              <input
                type="date"
                value={measuredAt}
                onChange={(e) => setMeasuredAt(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white"
              />
            </label>
            <button
              type="button"
              onClick={save}
              disabled={saving || rows.length === 0}
              className="rounded-full bg-emerald-500 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black disabled:opacity-50"
            >
              {saving ? "Saving…" : `Save ${rows.length}`}
            </button>
            <button
              type="button"
              onClick={() => setRows(null)}
              className="text-[10px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {saveMsg && <p className="mt-3 text-xs text-white/60">{saveMsg}</p>}
    </div>
  );
}
