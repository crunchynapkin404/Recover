import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// DB-gated: no separate test DB in this repo, every row here is test-*
// scoped (matches src/app/settings/__tests__/sessions.test.ts).
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-coach-actions-user";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireUser: requireUserMock,
}));

// revalidatePath requires a real Next.js request/static-generation
// context, which a plain vitest unit test has none of.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe.skipIf(!hasDb)("saveCoachSettings", () => {
  beforeEach(async () => {
    requireUserMock.mockResolvedValue({ id: USER });
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.llmSettings)
      .where(eq(schema.llmSettings.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Coach Actions Test",
        email: "coach-actions@example.invalid",
      })
      .onConflictDoNothing();
    await db.insert(schema.llmSettings).values({
      userId: USER,
      providerType: "anthropic",
      model: "claude-sonnet",
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.llmSettings)
      .where(eq(schema.llmSettings.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("rejects an invalid language code", async () => {
    const { saveCoachSettings } = await import("./coach-actions");
    const fd = new FormData();
    fd.set("personality", "encouraging");
    fd.set("language", "xx-bogus");
    const result = await saveCoachSettings(null, fd);
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid personality even with a valid language", async () => {
    const { saveCoachSettings } = await import("./coach-actions");
    const fd = new FormData();
    fd.set("personality", "not-a-real-one");
    fd.set("language", "nl");
    const result = await saveCoachSettings(null, fd);
    expect(result.ok).toBe(false);
  });

  it("persists both personality and language together", async () => {
    const { saveCoachSettings } = await import("./coach-actions");
    const { db, schema } = await import("@/lib/db");
    const fd = new FormData();
    fd.set("personality", "direct");
    fd.set("language", "nl");
    const result = await saveCoachSettings(null, fd);
    expect(result.ok).toBe(true);

    const row = await db.query.llmSettings.findFirst({
      where: eq(schema.llmSettings.userId, USER),
    });
    expect(row?.coachPersonality).toBe("direct");
    expect(row?.coachLanguage).toBe("nl");
  });

  it("defaults language to auto when the field is absent (backward compat)", async () => {
    const { saveCoachSettings } = await import("./coach-actions");
    const { db, schema } = await import("@/lib/db");
    const fd = new FormData();
    fd.set("personality", "analytical");
    const result = await saveCoachSettings(null, fd);
    expect(result.ok).toBe(true);

    const row = await db.query.llmSettings.findFirst({
      where: eq(schema.llmSettings.userId, USER),
    });
    expect(row?.coachLanguage).toBe("auto");
  });
});
