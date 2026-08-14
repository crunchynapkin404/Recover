import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { HistoryPanel, KIND_STYLE, stamp } from "./history-panel";
import type { InboxItem } from "@/lib/coach-inbox";

describe("HistoryPanel", () => {
  const item = (over: Partial<InboxItem> = {}): InboxItem => ({
    id: "m1",
    threadId: "th1",
    kind: "morning",
    title: "Morning brief",
    preview: "Readiness 71 (amber).",
    createdAt: new Date("2026-08-13T07:02:00Z"),
    unread: false,
    ...over,
  });

  it("renders a tile for every InboxKind", () => {
    const kinds = ["morning", "debrief", "weekly", "warning", "monthly"] as const;
    const html = renderToString(
      <HistoryPanel
        inboxItems={kinds.map((k, i) => item({ id: `m${i}`, threadId: `th${i}`, kind: k }))}
        threads={[]}
        activeThreadId={null}
        unread={0}
      />
    );
    for (const k of kinds) {
      // The glyph proves the tile rendered; the token proves it was styled
      // from the theme rather than a raw hue.
      expect(html).toContain(KIND_STYLE[k].glyph);
      expect(html).toContain(`var(--kind-${k}-ink)`);
    }
  });

  it("shows the unread dot only for unread items", () => {
    const read = renderToString(
      <HistoryPanel inboxItems={[item({ unread: false })]} threads={[]} activeThreadId={null} unread={0} />
    );
    const unread = renderToString(
      <HistoryPanel inboxItems={[item({ unread: true })]} threads={[]} activeThreadId={null} unread={1} />
    );
    // Sanity: both rendered the item at all.
    expect(read).toContain("Morning brief");
    expect(unread).toContain("Morning brief");
    expect(read).not.toContain('aria-label="Unread"');
    expect(unread).toContain('aria-label="Unread"');
  });

  it("renders both empty states when there is nothing at all", () => {
    const html = renderToString(
      <HistoryPanel inboxItems={[]} threads={[]} activeThreadId={null} unread={0} />
    );
    // Assert BOTH — one assertion passes vacuously if the other branch
    // silently disappeared.
    expect(html).toContain("Nothing from the coach yet.");
    expect(html).toContain("No conversations yet.");
  });

  it("separates ghost threads from ordinary chats", () => {
    const html = renderToString(
      <HistoryPanel
        inboxItems={[]}
        threads={[
          { id: "c1", title: "Ordinary chat", updatedAt: new Date().toISOString(), ephemeral: false },
          { id: "g1", title: "Ghost chat", updatedAt: new Date().toISOString(), ephemeral: true },
        ]}
        activeThreadId={null}
        unread={0}
      />
    );
    expect(html).toContain("Ordinary chat");
    expect(html).toContain("Ghost chat");
    // Isolate each row's own markup (split on the anchor boundary) so this
    // actually checks exclusivity instead of just presence somewhere in the
    // document — `toContain` alone would still pass if BOTH rows carried
    // the token.
    const rows = html.split("</a>");
    const ordinaryRow = rows.find((r) => r.includes("Ordinary chat"));
    const ghostRow = rows.find((r) => r.includes("Ghost chat"));
    expect(ordinaryRow).toBeDefined();
    expect(ghostRow).toBeDefined();
    // Only the ephemeral one carries the ghost ink token.
    expect(ghostRow).toContain("text-ghost-ink");
    expect(ordinaryRow).not.toContain("text-ghost-ink");
    expect(html.indexOf("Ordinary chat")).toBeLessThan(html.indexOf("Ghost chat"));
  });

  it("marks the active thread", () => {
    const threads = [
      { id: "c1", title: "First", updatedAt: new Date().toISOString(), ephemeral: false },
      { id: "c2", title: "Second", updatedAt: new Date().toISOString(), ephemeral: false },
    ];
    const html = renderToString(
      <HistoryPanel inboxItems={[]} threads={threads} activeThreadId="c2" unread={0} />
    );
    expect(html).toContain("First");
    expect(html).toContain("Second");
    // Isolate each row's own markup (split on the anchor boundary) so the
    // class check binds to identity, not just count — a count-only
    // assertion would still pass if the ternary picked the WRONG row.
    const rows = html.split("</a>");
    const firstRow = rows.find((r) => r.includes("First"));
    const secondRow = rows.find((r) => r.includes("Second"));
    expect(firstRow).toBeDefined();
    expect(secondRow).toBeDefined();
    // The active row gets the raised-surface treatment; exactly one does,
    // and it must be "Second" — the id actually passed as activeThreadId.
    expect(html.match(/bg-surface-overlay/g) ?? []).toHaveLength(1);
    expect(secondRow).toContain("bg-surface-overlay");
    expect(firstRow).not.toContain("bg-surface-overlay");
  });
});

describe("stamp", () => {
  it("gives HH:MM today, a weekday within the week, and a date beyond it", () => {
    // stamp() calls toLocaleTimeString/toLocaleDateString with NO `timeZone`
    // option, so it always renders in the HOST's local timezone. An ISO
    // offset (e.g. "+02:00") only pins the UTC instant a Date represents —
    // it does NOT control how that instant is displayed, so it is NOT
    // portable across host timezones.
    //
    // The local-time constructor IS portable: `new Date(2026, 7, 13, 7, 2)`
    // fixes the wall-clock in whatever timezone the process runs under, so
    // both construction and rendering share the same implicit local TZ and
    // the result is "07:02" on any host. (Month is 0-indexed: 7 = August,
    // 6 = July.) Verified under TZ=UTC, TZ=Europe/Amsterdam, and
    // TZ=Pacific/Auckland (across the date line from UTC).
    const now = new Date(2026, 7, 13, 10, 0);
    expect(stamp(new Date(2026, 7, 13, 7, 2), now)).toBe("07:02");
    expect(stamp(new Date(2026, 7, 10, 7, 2), now)).toBe("Mon");
    expect(stamp(new Date(2026, 6, 14, 7, 2), now)).toBe("Jul 14");
  });
});

describe("HistoryPanel layout invariants", () => {
  it("keeps the truncating title able to shrink beside the fixed stamp", () => {
    const html = renderToString(
      <HistoryPanel
        inboxItems={[]}
        threads={[
          {
            id: "t1",
            title: "A conversation title long enough to need truncation",
            updatedAt: new Date("2026-08-13T09:00:00Z").toISOString(),
            ephemeral: false,
          },
        ]}
        activeThreadId={null}
        unread={0}
        now={new Date("2026-08-13T10:00:00Z")}
      />
    );
    // Sanity: this asserts against real rendered content, not an empty string.
    expect(html).toContain("A conversation title long enough");
    // The stamp column must be shrink-0 AND the title must be allowed to
    // shrink, or widening the stamp to the 12px floor eats the title.
    expect(html).toMatch(/min-w-0[^"]*truncate|truncate[^"]*min-w-0/);
  });
});
