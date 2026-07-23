import Link from "next/link";
import type { InboxItem, InboxKind } from "@/lib/coach-inbox";

// Each kind gets one hue, used at 12% for the tile and 30% for its border —
// the same tinted-tile grammar the rest of the redesign uses.
const KIND_STYLE: Record<
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
function stamp(d: Date, now: Date): string {
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

/**
 * The coach inbox (1f) — one chronological rail of everything the coach
 * wrote unprompted. Tapping a row opens it as a thread in Chat, which is
 * also what marks it read.
 */
export function InboxRail({
  items,
  now = new Date(),
}: {
  items: InboxItem[];
  now?: Date;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-5 text-[12px] text-white/50">
        Nothing from the coach yet. Morning briefs, ride debriefs and weekly
        reviews land here as they&apos;re written.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.03]">
      {items.map((item) => {
        const style = KIND_STYLE[item.kind];
        return (
          <Link
            key={item.id}
            href={`/coach?thread=${item.threadId}`}
            className="flex gap-3 border-b border-white/[0.06] p-3.5 transition-colors last:border-0 hover:bg-white/[0.03]"
          >
            <span
              aria-hidden
              className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] border text-[14px]"
              style={{
                background: `rgba(${style.hue},0.12)`,
                borderColor: `rgba(${style.hue},0.3)`,
                color: `rgb(${style.hue})`,
              }}
            >
              {style.glyph}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-bold text-white">
                    {item.title}
                  </span>
                  {item.unread && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-emerald-400"
                      aria-label="Unread"
                    />
                  )}
                </span>
                <span className="shrink-0 text-[9.5px] text-white/35">
                  {stamp(item.createdAt, now)}
                </span>
              </span>
              <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-white/55">
                {item.preview}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
