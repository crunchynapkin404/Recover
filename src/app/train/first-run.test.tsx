import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";

// SidebarNav/BottomNav (rendered via AppShell) call usePathname/useRouter,
// which need the App Router context this test has none of.
vi.mock("next/navigation", () => ({
  usePathname: () => "/train",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireUser: requireUserMock,
}));

// requires Postgres; skips without DATABASE_URL. (See src/lib/first-run.test.ts.)
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const BARE_USER = "test-train-first-run-bare";
const BETWEEN_SEASONS_USER = "test-train-first-run-between-seasons";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * TrainPage is an async Server Component that itself renders further async
 * Server Components (WeekTab). `renderToString` cannot resolve those — it
 * throws "A component suspended while responding to synchronous input" —
 * so this needs the streaming renderer, which does resolve nested async
 * components, and then drains the stream back to a string.
 */
async function renderTrainPageAs(userId: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({})} />
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html;
}

describe.skipIf(!hasDb)("TrainPage first-run branch", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values([
        {
          id: BARE_USER,
          name: "Test Bare Athlete",
          email: `${BARE_USER}@example.invalid`,
        },
        {
          id: BETWEEN_SEASONS_USER,
          name: "Test Between Seasons Athlete",
          email: `${BETWEEN_SEASONS_USER}@example.invalid`,
        },
      ])
      .onConflictDoNothing();

    // Logged wellness before (isFirstRun -> false), but no active or draft
    // plan right now — the "established athlete between seasons" case.
    await db.insert(schema.wellnessDaily).values({
      userId: BETWEEN_SEASONS_USER,
      date: daysAgo(200),
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, BETWEEN_SEASONS_USER));
    await db.delete(schema.users).where(eq(schema.users.id, BARE_USER));
    await db
      .delete(schema.users)
      .where(eq(schema.users.id, BETWEEN_SEASONS_USER));
  });

  it("first-run shows a way back to the data paths", async () => {
    const html = await renderTrainPageAs(BARE_USER);
    expect(html).toContain('data-testid="first-run"');
    expect(html).toContain("Needs wellness data before it can plan your week");
    expect(html).toMatch(/Connect a device|add your first/i);
    expect(html).toContain('href="/"');
  });

  it("an established athlete between seasons keeps today's wording", async () => {
    const html = await renderTrainPageAs(BETWEEN_SEASONS_USER);
    expect(html).toContain(
      "No plan yet — generate one from a race goal, or plan just this week."
    );
    expect(html).not.toMatch(/Connect a device/i);
    expect(html).not.toContain('data-testid="first-run"');
  });
});
