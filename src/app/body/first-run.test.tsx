import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";

// SidebarNav/BottomNav (rendered via AppShell) call usePathname/useRouter,
// which need the App Router context this test has none of.
vi.mock("next/navigation", () => ({
  usePathname: () => "/body",
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

const BARE_USER = "test-body-first-run-bare";
const GAP_USER = "test-body-first-run-gap";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * BodyPage is an async Server Component that itself renders further async
 * Server Components (TrendsTab). `renderToString` cannot resolve those — it
 * throws "A component suspended while responding to synchronous input" —
 * so this needs the streaming renderer, which does resolve nested async
 * components, and then drains the stream back to a string. Same technique
 * as src/app/train/first-run.test.tsx.
 */
async function renderBodyPageAs(userId: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: BodyPage } = await import("./page");
  const stream = await renderToReadableStream(
    <BodyPage searchParams={Promise.resolve({})} />
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

describe.skipIf(!hasDb)("BodyPage first-run branch", () => {
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
          id: GAP_USER,
          name: "Test Gap Athlete",
          email: `${GAP_USER}@example.invalid`,
        },
      ])
      .onConflictDoNothing();

    // Logged wellness a year ago (isFirstRun -> false) but nothing inside
    // the default 90d range (TRAIN_DEFAULTS.range) — the "established
    // athlete, empty range" case that must keep today's per-card wording
    // untouched.
    await db.insert(schema.wellnessDaily).values({
      userId: GAP_USER,
      date: daysAgo(365),
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, GAP_USER));
    await db.delete(schema.users).where(eq(schema.users.id, BARE_USER));
    await db.delete(schema.users).where(eq(schema.users.id, GAP_USER));
  });

  it("says it once on first run, not four times", async () => {
    const html = await renderBodyPageAs(BARE_USER);
    expect(html).toContain('data-testid="first-run"');
    const matches =
      html.match(/Not enough readings|No wellness readings/g) ?? [];
    expect(matches).toHaveLength(0); // the first-run panel replaces them all
    expect(html).toContain('href="/"');
  });

  it("an established athlete with an empty range keeps today's wording", async () => {
    const html = await renderBodyPageAs(GAP_USER);
    expect(html).toContain("Not enough readings in this range yet.");
    expect(html).not.toContain('data-testid="first-run"');
  });
});
