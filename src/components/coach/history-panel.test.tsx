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
    // Only the ephemeral one carries the ghost ink token.
    expect(html).toContain("text-ghost-ink");
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
    // The active row gets the raised-surface treatment; exactly one does.
    expect(html.match(/bg-surface-overlay/g) ?? []).toHaveLength(1);
  });
});

describe("stamp", () => {
  it("gives HH:MM today, a weekday within the week, and a date beyond it", () => {
    const now = new Date("2026-08-13T10:00:00Z");
    // The container runs TZ=Europe/Amsterdam (CEST, UTC+2 in August); an
    // explicit +02:00 offset keeps the wall-clock unambiguous so this
    // doesn't flake under a different host timezone.
    expect(stamp(new Date("2026-08-13T07:02:00+02:00"), now)).toBe("07:02");
    expect(stamp(new Date("2026-08-10T07:02:00Z"), now)).toBe("Mon");
    expect(stamp(new Date("2026-07-14T07:02:00Z"), now)).toBe("Jul 14");
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
