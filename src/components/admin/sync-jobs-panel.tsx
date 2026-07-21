"use client";

import { useState, useTransition } from "react";
import { RotateCw, Zap } from "lucide-react";
import { retrySyncJob, kickUserSync } from "@/app/admin/actions";

export interface SyncJobRow {
  id: string;
  userId: string;
  userLabel: string;
  provider: string;
  kind: string;
  // Drizzle types this from the full column enum even though the page
  // query filters to pending/running/failed only ("done" excluded there).
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  lastError: string | null;
  runAfter: string;
  updatedAt: string;
}

interface UserOption {
  id: string;
  label: string;
}

interface Props {
  jobs: SyncJobRow[];
  users: UserOption[];
}

const PROVIDER_LABEL: Record<string, string> = {
  intervals_icu: "Intervals.icu",
  strava: "Strava",
  whoop: "Whoop",
  oura: "Oura",
  withings: "Withings",
};

function fmt(iso: string) {
  return iso.slice(0, 16).replace("T", " ");
}

export function SyncJobsPanel({ jobs, users }: Props) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState(users[0]?.id ?? "");

  const queue = jobs.filter((j) => j.status === "pending");
  const running = jobs.filter((j) => j.status === "running");
  const failed = jobs.filter((j) => j.status === "failed");

  const retry = (jobId: string) => {
    setError(null);
    setBusyId(jobId);
    startTransition(async () => {
      try {
        await retrySyncJob(jobId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Retry failed.");
      } finally {
        setBusyId(null);
      }
    });
  };

  const kick = (userId: string) => {
    setError(null);
    setBusyId(userId);
    startTransition(async () => {
      try {
        await kickUserSync(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kick failed.");
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro mb-4">
        Sync jobs — queue ({queue.length}) · running ({running.length}) · failed
        ({failed.length})
      </h3>

      {error && (
        <p role="status" className="mb-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {users.length > 0 && (
        <div className="mb-5 flex gap-2">
          <select
            value={kickTarget}
            onChange={(e) => setKickTarget(e.target.value)}
            aria-label="User to kick sync for"
            className="login-input flex-1 rounded-xl px-3 py-2.5 text-sm text-white"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending || !kickTarget}
            onClick={() => kick(kickTarget)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-black transition-all hover:bg-emerald-400 disabled:opacity-50"
          >
            <Zap aria-hidden className="size-4" />
            {isPending && busyId === kickTarget ? "Kicking…" : "Kick sync"}
          </button>
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="text-sm text-white/50">No active sync jobs.</p>
      ) : (
        <div className="space-y-5">
          <JobGroup title="Queue" rows={queue} emptyLabel="Nothing queued." />
          <JobGroup
            title="Running"
            rows={running}
            emptyLabel="Nothing running."
          />
          <JobGroup
            title="Failed"
            rows={failed}
            emptyLabel="No failures."
            onRetry={retry}
            busyId={isPending ? busyId : null}
          />
        </div>
      )}
    </section>
  );
}

function JobGroup({
  title,
  rows,
  emptyLabel,
  onRetry,
  busyId,
}: {
  title: string;
  rows: SyncJobRow[];
  emptyLabel: string;
  onRetry?: (jobId: string) => void;
  busyId?: string | null;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
        {title} ({rows.length})
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-white/40">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map((job) => (
            <li
              key={job.id}
              className="flex items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {job.userLabel}
                  <span className="ml-2 font-normal text-white/50">
                    {PROVIDER_LABEL[job.provider] ?? job.provider} · {job.kind}
                  </span>
                </p>
                <p className="truncate text-[10px] text-white/40">
                  attempts {job.attempts} · runs {fmt(job.runAfter)} · updated{" "}
                  {fmt(job.updatedAt)}
                </p>
                {job.lastError && (
                  <p className="mt-1 truncate text-[10px] text-red-400">
                    {job.lastError}
                  </p>
                )}
              </div>
              {onRetry && (
                <button
                  type="button"
                  disabled={busyId === job.id}
                  onClick={() => onRetry(job.id)}
                  aria-label={`Retry sync job for ${job.userLabel}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-50"
                >
                  <RotateCw aria-hidden className="size-3" />
                  {busyId === job.id ? "Retrying…" : "Retry"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
