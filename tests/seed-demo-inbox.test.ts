import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listInboxItems } from "@/lib/coach-inbox";
import { seedDemoInbox } from "../scripts/seed-demo";

/** DB suite; skips without Postgres (see [[recover-db-test-ci-guard]]). */
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-seed-demo-inbox-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("seedDemoInbox", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await cleanup();
    await db.insert(schema.users).values({
      id: USER,
      name: "SeedInboxTest",
      email: `${USER}@example.invalid`,
      role: "member",
    });
    await seedDemoInbox(USER);
  });

  afterAll(cleanup);

  it("produces one item for every InboxKind the UI can style", async () => {
    const items = await listInboxItems(USER);
    // Sanity: assert against real rows, not an empty list that would make
    // every set comparison below pass vacuously.
    expect(items.length).toBe(5);
    const kinds = new Set(items.map((i) => i.kind));
    // KIND_STYLE in history-panel.tsx has exactly these five keys. If this
    // set and that record diverge, a tile renders undefined styles. Note
    // "warning" is NOT a thread kind — it is derived from toolCalls.warning
    // on a `morning` thread (coach-inbox.ts:114-117), which is why the seed
    // creates two morning threads.
    expect(kinds).toEqual(
      new Set(["morning", "debrief", "weekly", "warning", "monthly"])
    );
  });

  it("leaves exactly one item unread, so the badge renders non-zero", async () => {
    const items = await listInboxItems(USER);
    expect(items.filter((i) => i.unread)).toHaveLength(1);
  });

  it("is idempotent — a second run adds nothing", async () => {
    const before = await listInboxItems(USER);
    await seedDemoInbox(USER);
    const after = await listInboxItems(USER);
    expect(after).toHaveLength(before.length);
  });
});
