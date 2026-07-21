"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { mintInvite } from "@/lib/invites";
import { requestImmediateSync } from "@/lib/sync/scheduler";

export interface AdminActionResult {
  ok: boolean;
  message: string;
  code?: string;
}

async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "owner") {
    throw new Error("Owner access required.");
  }
  return user;
}

export async function createInvite(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  const owner = await requireOwner();
  const email = String(formData.get("email") ?? "").trim() || undefined;
  const { code, expiresAt } = await mintInvite(owner.id, email);
  revalidatePath("/admin");
  return {
    ok: true,
    code,
    message: `Invite created — expires ${expiresAt.toISOString().slice(0, 10)}.`,
  };
}

export async function revokeInvite(
  inviteId: string
): Promise<AdminActionResult> {
  await requireOwner();
  await db.delete(schema.invites).where(eq(schema.invites.id, inviteId));
  revalidatePath("/admin");
  return { ok: true, message: "Invite revoked." };
}

/**
 * Reset a specific failed sync job back to `pending` so the scheduler picks
 * it up again. This is owner-only and acts on *other* users' jobs by
 * design — unlike every other action in this app, it must NOT be scoped to
 * the caller's own userId. The row is looked up by id alone.
 *
 * Flipping `status` back to "pending" is not sufficient on its own: a job
 * that exhausted its attempts (scheduler.ts's `runSchedulerTick`) carries an
 * exponential-backoff `runAfter` up to `2^MAX_ATTEMPTS` minutes in the
 * future, set at the moment it last failed. The tick loop's claim query is
 * `WHERE status = 'pending' AND run_after <= now()` — if we only touched
 * `status`, the retried job would sit invisible to the scheduler until that
 * old backoff window happened to elapse on its own. So `runAfter` is reset
 * to now here too, which is what actually makes "retry" mean "retry".
 *
 * `attempts` is intentionally left as-is (spec: "unchanged") and `lastError`
 * is cleared. Net effect: a manually retried job that was already at
 * MAX_ATTEMPTS gets exactly one more real attempt before failing for good
 * again — appropriate for a manual "try this once more" action, as opposed
 * to resetting the whole retry budget.
 */
export async function retrySyncJob(jobId: string): Promise<AdminActionResult> {
  await requireOwner();
  const [job] = await db
    .update(schema.syncJobs)
    .set({
      status: "pending",
      lastError: null,
      runAfter: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.syncJobs.id, jobId), eq(schema.syncJobs.status, "failed"))
    )
    .returning();
  if (!job) {
    throw new Error("Sync job not found, or not in a failed state.");
  }
  revalidatePath("/admin");
  return {
    ok: true,
    message: "Job reset — picked up by the next scheduler tick.",
  };
}

/**
 * Force an immediate sync for another user (owner-only "kick"). Wraps
 * `requestImmediateSync`, which already scopes entirely to the given
 * userId (bumps that user's pending jobs to now, or inserts new ones for
 * active connections with none) — no separate scoping needed here.
 *
 * Deliberately does NOT also call `runSchedulerTick()` (unlike
 * `/api/sync/now`, which does, for a single self-service user in one
 * request/response). `runSchedulerTick` is global and unscoped by user —
 * it advisory-locks and claims up to 10 due jobs system-wide. Running it as
 * a side effect of kicking one user would let a single admin action reach
 * into and mutate other users' unrelated due jobs, which is both a
 * surprising blast radius for a "kick this one user" button and, in tests
 * against this app's shared live database, a real risk of touching
 * non-test rows. The kicked job's `runAfter` is pulled to now here, so the
 * ambient scheduler (60s in-process interval, or the next external cron
 * hit) picks it up on its own shortly after — same mechanism `retrySyncJob`
 * relies on above.
 */
export async function kickUserSync(userId: string): Promise<AdminActionResult> {
  await requireOwner();
  await requestImmediateSync(userId);
  revalidatePath("/admin");
  return {
    ok: true,
    message: "Sync requested — picked up by the next scheduler tick.",
  };
}
