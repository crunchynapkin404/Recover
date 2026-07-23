"use client";

import Link from "next/link";
import { Ghost, Search } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { InboxItem, InboxKind } from "@/lib/coach-inbox";

// Each kind gets one hue, used at 12% for the tile and 30% for its border —
// the same tinted-tile grammar the rest of the redesign uses.
export const KIND_STYLE: Record<
  InboxKind,
  { glyph: string; hue: string; label: string }
> = {
  morning: { glyph: "☀", hue: "245,158,11", label: "Morning brief" },
  debrief: { glyph: "✓", hue: "16,185,129", label: "Ride debrief" },
  weekly: { glyph: "▤", hue: "139,92,246", label: "Weekly review" },
  warning: { glyph: "⚠", hue: "239,68,68", label: "Overtraining watch" },
  monthly: { glyph: "◔", hue: "59,130,246", label: "Monthly report" },
};

/** "07:02" today, "Mon" this week, "Jul 14" beyond it. */
export function stamp(d: Date, now: Date): string {
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface HistoryThread {
  id: string;
  title: string;
  updatedAt: string;
  ephemeral: boolean;
}

interface HistoryPanelProps {
  inboxItems: InboxItem[];
  /** Already scoped to kind === "chat" — system threads live in inboxItems. */
  threads: HistoryThread[];
  activeThreadId: string | null;
  unread: number;
  now?: Date;
}

/**
 * The merged Inbox + History surface (v0.24) — "From your coach" (system
 * threads read as mail) above "Chats" (the athlete's own conversations).
 * Shared by the desktop dropdown and the mobile sheet; only the container
 * around it differs.
 */
export function HistoryPanel({
  inboxItems,
  threads,
  activeThreadId,
  unread,
  now = new Date(),
}: HistoryPanelProps) {
  const chats = threads.filter((t) => !t.ephemeral);
  const ghosts = threads.filter((t) => t.ephemeral);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 text-white/35">
        <Search className="size-3.5 shrink-0" aria-hidden />
        {/* Static for v1 — wires to recall search later. */}
        <input
          type="search"
          placeholder="Search chats & reviews"
          disabled
          className="w-full bg-transparent text-[12px] text-white/60 outline-none placeholder:text-white/35"
        />
      </div>

      <div>
        <p className="px-1 pb-2 text-[9.5px] font-bold uppercase tracking-[0.2em] text-white/35">
          From your coach
          {unread > 0 && <span className="text-emerald-400"> · {unread}</span>}
        </p>
        {inboxItems.length === 0 ? (
          <p className="px-1 pb-3 text-[11px] text-white/40">
            Nothing from the coach yet.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 pb-3">
            {inboxItems.map((item) => {
              const style = KIND_STYLE[item.kind];
              const active = item.threadId === activeThreadId;
              return (
                <Link
                  key={item.id}
                  href={`/coach?thread=${item.threadId}`}
                  className={`flex items-center gap-2.5 rounded-xl p-2 transition-colors ${
                    active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-[9px] border text-[12px]"
                    style={{
                      background: `rgba(${style.hue},0.12)`,
                      borderColor: `rgba(${style.hue},0.3)`,
                      color: `rgb(${style.hue})`,
                    }}
                  >
                    {style.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-bold text-white">
                        {item.title}
                      </span>
                      {item.unread && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-emerald-400"
                          aria-label="Unread"
                        />
                      )}
                    </span>
                    <span className="block truncate text-[10.5px] text-white/45">
                      {item.preview}
                    </span>
                  </span>
                  <span className="shrink-0 text-[9.5px] text-white/35">
                    {stamp(item.createdAt, now)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <p className="px-1 pb-2 text-[9.5px] font-bold uppercase tracking-[0.2em] text-white/35">
          Chats
        </p>
        {chats.length === 0 && ghosts.length === 0 ? (
          <p className="px-1 text-[11px] text-white/40">
            No conversations yet.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {chats.map((t) => (
              <Link
                key={t.id}
                href={`/coach?thread=${t.id}`}
                className={`flex items-center justify-between gap-2 rounded-xl px-2 py-2 transition-colors ${
                  t.id === activeThreadId
                    ? "bg-white/[0.08] text-white"
                    : "text-white/65 hover:bg-white/[0.04]"
                }`}
              >
                <span className="truncate text-[12.5px] font-medium">
                  {t.title}
                </span>
                <span className="shrink-0 text-[9.5px] text-white/35">
                  {stamp(new Date(t.updatedAt), now)}
                </span>
              </Link>
            ))}
            {ghosts.map((t) => (
              <Link
                key={t.id}
                href={`/coach?thread=${t.id}`}
                className={`flex items-center gap-1.5 rounded-xl px-2 py-2 transition-colors ${
                  t.id === activeThreadId
                    ? "bg-purple-500/20 text-purple-200"
                    : "text-purple-300/60 hover:bg-white/[0.04]"
                }`}
              >
                <Ghost className="size-3 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                  {t.title}
                </span>
                <span className="shrink-0 text-[9.5px] text-white/35">
                  {stamp(new Date(t.updatedAt), now)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Mobile container (1c) — the same list, in the shared bottom-sheet shell. */
export function HistorySheet({
  inboxItems,
  threads,
  activeThreadId,
  unread,
  closeHref,
}: HistoryPanelProps & { closeHref: string }) {
  return (
    <BottomSheet title="History" closeHref={closeHref}>
      <HistoryPanel
        inboxItems={inboxItems}
        threads={threads}
        activeThreadId={activeThreadId}
        unread={unread}
      />
    </BottomSheet>
  );
}
