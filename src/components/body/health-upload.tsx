"use client";

import { useActionState, useState, useTransition } from "react";
import {
  extractAction,
  saveBiomarkers,
  type ExtractResult,
  type SaveRow,
} from "@/app/health/actions";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";

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
    <Collapsible
      // An extraction in review keeps the panel open: the rows live in this
      // component's state across a server action, and folding a half-reviewed
      // table out of sight is how an athlete loses one.
      defaultOpen={rows !== null}
    >
      <CollapsibleTrigger>
        <span className="label-micro">Add a blood test</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="p-5 pt-4">
          <p className="text-label text-ink-muted">
            Upload a PDF/photo or paste the values. They&apos;re extracted for
            you to review — nothing is saved until you confirm.
          </p>

          {!rows && (
            <form action={action} className="mt-4 space-y-3">
              <textarea
                name="text"
                rows={4}
                placeholder={"Paste lab values, e.g.\nLDL Cholesterol 95 mg/dL"}
                className="w-full rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary"
              />
              <div className="flex items-center gap-2">
                {/* A visible label, not aria-label: the input had no
                    accessible name at all (confirmed axe violation, both
                    themes — Task 1). "Measured" below uses the same
                    wrap-the-input pattern, so this reads as one label, not a
                    bolted-on fix. */}
                <label
                  htmlFor="health-upload-file"
                  className="flex min-w-0 flex-1 items-center gap-2 text-label text-ink-secondary"
                >
                  <span className="shrink-0">File</span>
                  <input
                    id="health-upload-file"
                    type="file"
                    name="file"
                    accept="application/pdf,image/*"
                    className="min-w-0 flex-1 text-label text-ink-secondary file:mr-3 file:rounded-full file:border-0 file:bg-surface-overlay file:px-3 file:py-1.5 file:text-label file:font-bold file:uppercase file:tracking-wider file:text-ink-secondary"
                  />
                </label>
                <button
                  type="submit"
                  disabled={extracting}
                  className="shrink-0 rounded-full bg-accent px-4 py-2 text-label font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
                >
                  {extracting ? "Reading…" : "Extract"}
                </button>
              </div>
              {state && !state.ok && (
                <p role="status" className="text-label text-chart-5">
                  {state.message}
                </p>
              )}
            </form>
          )}

          {rows && (
            <div className="mt-4">
              {state?.method === "text-parser" && (
                <p className="mb-2 text-label text-chart-3">
                  Parsed without a model — double-check the values.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-caption">
                  <thead>
                    <tr className="text-left text-label uppercase tracking-wider text-ink-muted">
                      <th className="pb-2 pr-2 font-bold">Marker</th>
                      <th className="pb-2 pr-2 font-bold">Value</th>
                      <th className="pb-2 pr-2 font-bold">Unit</th>
                      <th className="pb-2 pr-2 font-bold">Conf.</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-hairline">
                        <td className="py-1 pr-2">
                          <input
                            value={r.displayName}
                            onChange={(e) =>
                              update(i, { displayName: e.target.value })
                            }
                            className="w-full rounded-lg bg-surface-overlay px-2 py-1 text-ink-primary"
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
                            className="w-20 rounded-lg bg-surface-overlay px-2 py-1 text-ink-primary"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            value={r.unit ?? ""}
                            onChange={(e) =>
                              update(i, { unit: e.target.value || null })
                            }
                            className="w-20 rounded-lg bg-surface-overlay px-2 py-1 text-ink-primary"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <span
                            className={`text-label font-numeric ${
                              (r.confidence ?? 1) < 0.6
                                ? "text-chart-3"
                                : "text-ink-muted"
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
                            className="rounded px-2 py-1 text-label text-ink-muted hover:text-chart-5"
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
                <label className="flex items-center gap-2 text-label text-ink-secondary">
                  Measured
                  <input
                    type="date"
                    value={measuredAt}
                    onChange={(e) => setMeasuredAt(e.target.value)}
                    className="rounded-lg border border-hairline bg-surface-overlay px-2 py-1 text-ink-primary"
                  />
                </label>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || rows.length === 0}
                  className="rounded-full bg-accent px-4 py-2 text-label font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
                >
                  {saving ? "Saving…" : `Save ${rows.length}`}
                </button>
                <button
                  type="button"
                  onClick={() => setRows(null)}
                  className="text-label font-bold uppercase tracking-wider text-ink-muted hover:text-ink-secondary"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {saveMsg && (
            <p className="mt-3 text-label text-ink-secondary">{saveMsg}</p>
          )}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
