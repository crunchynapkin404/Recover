import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";

// SidebarNav/BottomNav (rendered via AppShell) call usePathname/useRouter,
// which need the App Router context this test has none of. Same mock as
// src/app/train/first-run.test.tsx and its siblings.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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

const BARE_USER = "test-today-first-run-bare";
const RETURNING_USER = "test-today-first-run-returning";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * DashboardPage is an async Server Component that itself renders further
 * async Server Components. `renderToString` cannot resolve those — it
 * throws "A component suspended while responding to synchronous input" —
 * so this needs the streaming renderer, which does resolve nested async
 * components, and then drains the stream back to a string. Same technique
 * as src/app/train/first-run.test.tsx.
 */
async function renderDashboardPageAs(userId: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: DashboardPage } = await import("./page");
  const stream = await renderToReadableStream(
    <DashboardPage searchParams={Promise.resolve({})} />
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

describe.skipIf(!hasDb)("DashboardPage first-run branch", () => {
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
          id: RETURNING_USER,
          name: "Test Returning Athlete",
          email: `${RETURNING_USER}@example.invalid`,
        },
      ])
      .onConflictDoNothing();

    // Logged wellness once, 200 days ago, and nothing since — the exact
    // shape of the release's deliberate behaviour change. isFirstRun()
    // counts all of history, not a 90-day window, so this athlete must NOT
    // be routed back to the welcome card even though they look dataless by
    // the old inline check's standard. See src/lib/first-run.test.ts's
    // identical RETURNING_USER case.
    await db.insert(schema.wellnessDaily).values({
      userId: RETURNING_USER,
      date: daysAgo(200),
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, RETURNING_USER));
    await db.delete(schema.users).where(eq(schema.users.id, BARE_USER));
    await db.delete(schema.users).where(eq(schema.users.id, RETURNING_USER));
  });

  it("a dataless owner sees the welcome card", async () => {
    const html = await renderDashboardPageAs(BARE_USER);
    expect(html).toContain('data-testid="first-run"');
    expect(html).toContain("Welcome to Recover");
    expect(html).toContain("Connect a device");
  });

  it("an athlete with wellness older than 90 days and no connection does NOT see it", async () => {
    // This is the regression the release's behaviour change could
    // reintroduce: the old gate windowed wellness to 90 days, so this
    // athlete used to be shown the welcome card as though brand new.
    // isFirstRun() counts all of history, so they no longer are.
    const html = await renderDashboardPageAs(RETURNING_USER);
    expect(html).not.toContain('data-testid="first-run"');
    expect(html).not.toContain("Welcome to Recover");
    expect(html).toContain("Check in");
  });
});
