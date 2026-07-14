/**
 * Runs once per server boot (Next.js instrumentation hook):
 * first-boot owner seeding + the in-process sync scheduler tick.
 */

const TICK_MS = 60_000;

declare global {
  var __recoverSchedulerStarted: boolean | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureOwnerSeeded } = await import("@/lib/bootstrap");
  try {
    await ensureOwnerSeeded();
  } catch (err) {
    console.error("owner seeding failed:", err);
  }

  // In-process scheduler (self-host path). pg driver only; the serverless
  // path uses /api/cron instead. globalThis guard survives dev hot reloads.
  if (
    process.env.DATABASE_DRIVER === "pg" &&
    !globalThis.__recoverSchedulerStarted
  ) {
    globalThis.__recoverSchedulerStarted = true;
    const { ensureJobsForConnections, runSchedulerTick } =
      await import("@/lib/sync/scheduler");
    const tick = async () => {
      try {
        await ensureJobsForConnections();
        await runSchedulerTick();
      } catch (err) {
        console.error("scheduler tick failed:", err);
      }
    };
    setInterval(tick, TICK_MS).unref();
    void tick();
  }
}
