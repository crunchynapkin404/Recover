"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

function relative(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function subscribeNever() {
  return () => {};
}

// True only once hydrated on the client. Relative time reads differently at
// SSR vs. hydration instants, so the server/first-client snapshot (false)
// renders a stable placeholder and only the real client snapshot (true)
// computes it — no setState-in-effect, no hydration mismatch.
function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function SyncChip({ lastSyncAt }: { lastSyncAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(lastSyncAt);
  const mounted = useHasMounted();

  async function syncNow() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sync/now", { method: "POST" });
      if (res.status === 429) {
        toast.info("Sync was just requested — give it a minute.");
      } else if (!res.ok) {
        toast.error("Sync failed.");
      } else {
        const data = (await res.json()) as { lastSyncAt: string | null };
        setLast(data.lastSyncAt);
        router.refresh();
      }
    } catch {
      toast.error("Sync failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={syncNow}
      disabled={busy}
      aria-label="Sync now"
      className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white/50 transition-colors hover:text-white/80"
    >
      <RefreshCw className={`size-3 ${busy ? "animate-spin" : ""}`} />
      <span>{busy ? "Syncing…" : `Synced ${mounted ? relative(last) : "…"}`}</span>
    </button>
  );
}
