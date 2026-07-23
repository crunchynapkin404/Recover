import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * The coach inbox is a view over messages the coach already wrote into
 * system threads — no new tables. These tests cover the parts that would
 * quietly lie if they broke: which messages count as mail, how an item is
 * typed, and that reading is scoped to the account that owns the thread.
 *
 * DB suite; skips without Postgres (see [[recover-db-test-ci-guard]]).
 */
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-coach-inbox-user";
const OTHER = "test-coach-inbox-other-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  for (const id of [USER, OTHER]) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

async function seedUsers() {
  const { db, schema } = await import("@/lib/db");
  for (const id of [USER, OTHER]) {
    await db
      .insert(schema.users)
      .values({
        id,
        name: "InboxTest",
        email: `${id}@example.invalid`,
        role: "member",
      })
      .onConflictDoNothing();
  }
}

async function thread(
  userId: string,
  kind: "chat" | "morning" | "weekly" | "debrief" | "monthly",
  title: string | null = null
) {
  const { db, schema } = await import("@/lib/db");
  const [row] = await db
    .insert(schema.chatThreads)
    .values({ userId, kind, title })
    .returning();
  return row.id;
}

async function message(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  toolCalls: unknown = null
) {
  const { db, schema } = await import("@/lib/db");
  const [row] = await db
    .insert(schema.chatMessages)
    .values({ threadId, role, content, toolCalls })
    .returning();
  return row.id;
}

describe.skipIf(!hasDb)("coach inbox", () => {
  beforeEach(async () => {
    await cleanup();
    await seedUsers();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("lists coach-authored messages from system threads, newest first", async () => {
    const { listInboxItems } = await import("@/lib/coach-inbox");
    const morning = await thread(USER, "morning");
    const weekly = await thread(USER, "weekly");
    await message(morning, "assistant", "Readiness 66 — HRV under baseline.");
    await message(weekly, "assistant", "Load 412 vs 388 last week.");

    const items = await listInboxItems(USER);
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("weekly");
    expect(items[1].kind).toBe("morning");
    expect(items[1].preview).toContain("Readiness 66");
  });

  it("ignores the athlete's own replies and ordinary chat threads", async () => {
    const { listInboxItems } = await import("@/lib/coach-inbox");
    const morning = await thread(USER, "morning");
    await message(morning, "assistant", "Brief.");
    await message(morning, "user", "Thanks, will do.");
    const chat = await thread(USER, "chat", "How's my form?");
    await message(chat, "assistant", "Your form is fine.");

    const items = await listInboxItems(USER);
    expect(items).toHaveLength(1);
    expect(items[0].preview).toBe("Brief.");
  });

  it("types a morning message carrying a warning as an overtraining watch", async () => {
    const { listInboxItems } = await import("@/lib/coach-inbox");
    const morning = await thread(USER, "morning");
    await message(morning, "assistant", "HRV suppressed three days.", {
      warning: "hrv_suppression",
    });

    const [item] = await listInboxItems(USER);
    expect(item.kind).toBe("warning");
    expect(item.title).toContain("Overtraining watch");
    expect(item.title).toContain("hrv suppression");
  });

  it("titles a ride debrief with its activity", async () => {
    const { listInboxItems } = await import("@/lib/coach-inbox");
    const t = await thread(USER, "debrief", "Endurance Spin");
    await message(t, "assistant", "Legs felt flat early.");

    const [item] = await listInboxItems(USER);
    expect(item.title).toBe("Ride debrief — Endurance Spin");
  });

  it("counts unread, and opening the thread clears it", async () => {
    const { unreadInboxCount, markThreadRead, listInboxItems } =
      await import("@/lib/coach-inbox");
    const morning = await thread(USER, "morning");
    await message(morning, "assistant", "One.");
    await message(morning, "assistant", "Two.");

    expect(await unreadInboxCount(USER)).toBe(2);
    await markThreadRead(USER, morning);
    expect(await unreadInboxCount(USER)).toBe(0);
    expect((await listInboxItems(USER)).every((i) => !i.unread)).toBe(true);
  });

  it("never marks another account's thread read", async () => {
    const { unreadInboxCount, markThreadRead } =
      await import("@/lib/coach-inbox");
    const mine = await thread(USER, "morning");
    await message(mine, "assistant", "Mine.");
    const theirs = await thread(OTHER, "morning");
    await message(theirs, "assistant", "Theirs.");

    await markThreadRead(USER, theirs);
    expect(await unreadInboxCount(OTHER)).toBe(1);
    expect(await unreadInboxCount(USER)).toBe(1);
  });

  it("returns nothing for an athlete the coach hasn't written to", async () => {
    const { listInboxItems, unreadInboxCount } =
      await import("@/lib/coach-inbox");
    expect(await listInboxItems(USER)).toEqual([]);
    expect(await unreadInboxCount(USER)).toBe(0);
  });
});

describe("previewText", () => {
  it("strips bold and italics without touching the words", async () => {
    const { previewText } = await import("@/lib/coach-inbox");
    expect(previewText("**Amber-band status** — manage *carefully*.")).toBe(
      "Amber-band status — manage carefully."
    );
  });

  it("flattens headings, quotes and code to plain text", async () => {
    const { previewText } = await import("@/lib/coach-inbox");
    expect(previewText("## Week 6\n> held Z2\nuse `ftp` here")).toBe(
      "Week 6 held Z2 use ftp here"
    );
  });

  it("keeps link text and drops the URL", async () => {
    const { previewText } = await import("@/lib/coach-inbox");
    expect(previewText("see [your week](/train?tab=week) for detail")).toBe(
      "see your week for detail"
    );
  });

  it("leaves arithmetic and units alone", async () => {
    const { previewText } = await import("@/lib/coach-inbox");
    expect(previewText("CTL 51 → 58, 2×20 @ 88–93% FTP")).toBe(
      "CTL 51 → 58, 2×20 @ 88–93% FTP"
    );
  });

  it("collapses the newlines a two-line clamp can't show anyway", async () => {
    const { previewText } = await import("@/lib/coach-inbox");
    expect(previewText("one\n\ntwo\n   three")).toBe("one two three");
  });
});

describe.skipIf(!hasDb)("coach inbox titles", () => {
  beforeEach(async () => {
    await cleanup();
    await seedUsers();
  });

  it("doesn't print 'Ride debrief' twice when the thread already says it", async () => {
    const { listInboxItems } = await import("@/lib/coach-inbox");
    const t = await thread(
      USER,
      "debrief",
      "Ride debrief — Heerlen 2026-07-21"
    );
    await message(t, "assistant", "Solid ride.");

    const [item] = await listInboxItems(USER);
    expect(item.title).toBe("Ride debrief — Heerlen 2026-07-21");
    expect(item.title.match(/Ride debrief/g)).toHaveLength(1);
  });
});
