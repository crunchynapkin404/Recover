import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";

// SidebarNav/BottomNav (rendered via AppShell) call usePathname/useRouter,
// which need the App Router context this test has none of. CoachPage itself
// imports `redirect` from the same module for the tab=inbox case, which
// these tests never hit.
vi.mock("next/navigation", () => ({
  usePathname: () => "/coach",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

// ChatInterface (rendered in the non-first-run, no-key case) calls useChat.
// Same mock shape chat-interface.test.tsx already uses for its own tests.
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    setMessages: vi.fn(),
    error: undefined,
  }),
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

const BARE_USER = "test-coach-first-run-bare";
const NO_KEY_USER = "test-coach-first-run-no-key";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * CoachPage is an async Server Component. `renderToString` cannot resolve
 * an async function component (it suspends synchronously) — the streaming
 * renderer can, so this renders through that and drains the stream back to
 * a string. See src/app/train/first-run.test.tsx for the same technique.
 */
async function renderCoachPageAs(userId: string): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: CoachPage } = await import("./page");
  const stream = await renderToReadableStream(
    <CoachPage searchParams={Promise.resolve({})} />
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

describe.skipIf(!hasDb)("CoachPage first-run branch", () => {
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
          id: NO_KEY_USER,
          name: "Test No Key Athlete",
          email: `${NO_KEY_USER}@example.invalid`,
        },
      ])
      .onConflictDoNothing();

    // Logged wellness before (isFirstRun -> false) but never configured an
    // LLM key — the "established athlete with data but no key" case.
    await db.insert(schema.wellnessDaily).values({
      userId: NO_KEY_USER,
      date: daysAgo(30),
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, NO_KEY_USER));
    await db.delete(schema.users).where(eq(schema.users.id, BARE_USER));
    await db.delete(schema.users).where(eq(schema.users.id, NO_KEY_USER));
  });

  it("first-run points at the data paths, not just the key", async () => {
    const html = await renderCoachPageAs(BARE_USER);
    expect(html).toContain('data-testid="first-run"');
    expect(html).toContain(
      "Needs some training data before the coach has anything to talk about"
    );
    expect(html).toMatch(/Connect a device|add your first/i);
    expect(html).toContain('href="/"');
    expect(html).not.toContain("needs an LLM key");
  });

  it("keeps the LLM-key message for an athlete with data but no key", async () => {
    const html = await renderCoachPageAs(NO_KEY_USER);
    expect(html).toContain("needs an LLM key");
    expect(html).not.toContain('data-testid="first-run"');
  });
});
