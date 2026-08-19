import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import {
  HistoryPanel,
  KIND_STYLE,
  stamp,
  type HistoryThread,
} from "./history-panel";
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
    const kinds = [
      "morning",
      "debrief",
      "weekly",
      "warning",
      "monthly",
    ] as const;
    const html = renderToString(
      <HistoryPanel
        inboxItems={kinds.map((k, i) =>
          item({ id: `m${i}`, threadId: `th${i}`, kind: k })
        )}
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
      <HistoryPanel
        inboxItems={[item({ unread: false })]}
        threads={[]}
        activeThreadId={null}
        unread={0}
      />
    );
    const unread = renderToString(
      <HistoryPanel
        inboxItems={[item({ unread: true })]}
        threads={[]}
        activeThreadId={null}
        unread={1}
      />
    );
    // Sanity: both rendered the item at all.
    expect(read).toContain("Morning brief");
    expect(unread).toContain("Morning brief");
    expect(read).not.toContain('aria-label="Unread"');
    expect(unread).toContain('aria-label="Unread"');
  });

  it("renders both empty states when there is nothing at all", () => {
    const html = renderToString(
      <HistoryPanel
        inboxItems={[]}
        threads={[]}
        activeThreadId={null}
        unread={0}
      />
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
          {
            id: "c1",
            title: "Ordinary chat",
            updatedAt: new Date().toISOString(),
            ephemeral: false,
          },
          {
            id: "g1",
            title: "Ghost chat",
            updatedAt: new Date().toISOString(),
            ephemeral: true,
          },
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
    expect(html.indexOf("Ordinary chat")).toBeLessThan(
      html.indexOf("Ghost chat")
    );
  });

  it("marks the active thread", () => {
    const threads = [
      {
        id: "c1",
        title: "First",
        updatedAt: new Date().toISOString(),
        ephemeral: false,
      },
      {
        id: "c2",
        title: "Second",
        updatedAt: new Date().toISOString(),
        ephemeral: false,
      },
    ];
    const html = renderToString(
      <HistoryPanel
        inboxItems={[]}
        threads={threads}
        activeThreadId="c2"
        unread={0}
      />
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
    // The active row gets the selected-surface treatment; exactly one does,
    // and it must be "Second" — the id actually passed as activeThreadId.
    // Binds to `bg-surface-selected`, NOT `bg-surface-overlay` (C2,
    // whole-branch review 2026-08-14): the dropdown/sheet container around
    // this list is itself `bg-surface-overlay`, so painting the active row
    // with that same token makes it invisible against its own background.
    expect(html.match(/bg-surface-selected/g) ?? []).toHaveLength(1);
    expect(secondRow).toContain("bg-surface-selected");
    expect(firstRow).not.toContain("bg-surface-selected");
  });

  it("marks the active inbox item, distinctly from its own bg-surface-overlay container", () => {
    // The inbox branch has no resting "active" look of its own to fall back
    // on — the inactive arm is `hover:bg-surface-raised`, not a base style —
    // so if this token collides with the container's, the active state is
    // not merely degraded, it is gone entirely (C2, whole-branch review
    // 2026-08-14). No existing fixture set `activeThreadId` against an
    // inbox item before this test, so this branch of the ternary had never
    // been exercised.
    const html = renderToString(
      <HistoryPanel
        inboxItems={[
          item({ id: "m1", threadId: "th1", title: "First brief" }),
          item({ id: "m2", threadId: "th2", title: "Second brief" }),
        ]}
        threads={[]}
        activeThreadId="th2"
        unread={0}
      />
    );
    const rows = html.split("</a>");
    const firstRow = rows.find((r) => r.includes("First brief"));
    const secondRow = rows.find((r) => r.includes("Second brief"));
    expect(firstRow).toBeDefined();
    expect(secondRow).toBeDefined();
    expect(secondRow).toContain("bg-surface-selected");
    expect(secondRow).not.toContain("bg-surface-overlay");
    expect(firstRow).not.toContain("bg-surface-selected");
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

  const thread = (over: Partial<HistoryThread> = {}): HistoryThread => ({
    id: "t1",
    title: "Should I go hard today?",
    updatedAt: "2026-08-15T09:00:00Z",
    ephemeral: false,
    ...over,
  });

  /**
   * Until v0.113 the selected thread was distinguished by background colour
   * alone — `bg-surface-selected` on chats, `bg-ghost-tint` on ghosts — which
   * is a WCAG 1.4.1 problem and one axe cannot report: "this link is the page
   * you are on" is not inferable from a class. It went unnoticed for as long
   * as it did because no capture had ever rendered a selected row at all
   * (v0.113's `coach-history-active` surface).
   */
  describe("the selected thread is programmatic, not just coloured", () => {
    it("marks the active chat row with aria-current", () => {
      const html = renderToString(
        <HistoryPanel
          inboxItems={[]}
          threads={[thread({ id: "a" }), thread({ id: "b", title: "Other" })]}
          activeThreadId="a"
          unread={0}
        />
      );
      expect(html).toContain('aria-current="page"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    });

    it("marks the active GHOST row too — the subtler of the two tints", () => {
      const html = renderToString(
        <HistoryPanel
          inboxItems={[]}
          threads={[thread({ id: "g", ephemeral: true })]}
          activeThreadId="g"
          unread={0}
        />
      );
      expect(html).toContain('aria-current="page"');
    });

    it("marks nothing when no thread is active", () => {
      const html = renderToString(
        <HistoryPanel
          inboxItems={[]}
          threads={[thread(), thread({ id: "t2", ephemeral: true })]}
          activeThreadId={null}
          unread={0}
        />
      );
      expect(html).not.toContain("aria-current");
    });
  });

  /**
   * The hydration contract for the stamp column.
   *
   * `stamp` formats with no explicit `timeZone` and reads a `now` that is a
   * different instant on each side, so its answer cannot agree between server
   * and client. On /coach?history=1 that shipped a server "10:35" against a
   * client "08:35" and React regenerated the tree. The athlete's own local
   * time is the right answer, so the client is now the only side that
   * answers — `renderToString` (which runs no effects, exactly like the
   * server) must emit no time at all.
   */
  describe("timestamps do not render before hydration", () => {
    it("emits no stamp text on a server render", () => {
      const html = renderToString(
        <HistoryPanel
          inboxItems={[
            {
              id: "m1",
              threadId: "th1",
              kind: "morning",
              title: "Morning brief",
              preview: "Readiness 71 (amber).",
              createdAt: new Date("2026-08-13T07:02:00Z"),
              unread: false,
            },
          ]}
          threads={[
            {
              id: "t1",
              title: "Should I go hard today?",
              updatedAt: "2026-08-13T06:00:00Z",
              ephemeral: false,
            },
          ]}
          activeThreadId={null}
          unread={0}
          now={new Date("2026-08-13T09:00:00Z")}
        />
      );
      // Any of stamp()'s three shapes appearing here is the bug returning.
      expect(html).not.toMatch(/\d{2}:\d{2}/);
      expect(html).not.toMatch(/>(Mon|Tue|Wed|Thu|Fri|Sat|Sun)</);
      expect(html).not.toMatch(/>[A-Z][a-z]{2} \d{1,2}</);
    });

    it("still renders the rows themselves, only the times are deferred", () => {
      const html = renderToString(
        <HistoryPanel
          inboxItems={[]}
          threads={[
            {
              id: "t1",
              title: "Should I go hard today?",
              updatedAt: "2026-08-13T06:00:00Z",
              ephemeral: false,
            },
          ]}
          activeThreadId={null}
          unread={0}
        />
      );
      expect(html).toContain("Should I go hard today?");
    });
  });
});
