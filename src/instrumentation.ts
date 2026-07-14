/**
 * Runs once per server boot (Next.js instrumentation hook).
 * P1: first-boot owner seeding. P2 adds the sync scheduler tick here.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureOwnerSeeded } = await import("@/lib/bootstrap");
    try {
      await ensureOwnerSeeded();
    } catch (err) {
      console.error("owner seeding failed:", err);
    }
  }
}
