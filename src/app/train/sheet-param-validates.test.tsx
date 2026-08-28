import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToReadableStream } from "react-dom/server";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";

// Same App Router shims first-run.test.tsx and day-param-self-heals.test.tsx
// need — SidebarNav/BottomNav call usePathname/useRouter, which need
// context this test has none of. BottomSheet (rendered when ?sheet=why-week
// resolves) additionally calls useRouter().push on close, already covered
// by the same push stub.
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

// `?sheet=` is untrusted URL input — this is where the interesting bug
// could hide (the same class `openDayFrom` and SheetHost's UUID guard
// exist to close off). A membership Set built and then never consulted
// would let ANY string through as if it were "why-week"; this test only
// fails if the validation is both present AND actually read.
const TEST_USER = "test-train-sheet-param-validates";

const WEEK_START = mondayOf(new Date());

function emptyDay(date: string): DaySlot {
  return {
    date,
    availableBlocks: [],
    availableMins: 0,
    workouts: [],
    status: "rest",
  };
}

async function seedOpenWeek(userId: string): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  await db.insert(schema.users).values({
    id: userId,
    name: "Test Athlete",
    email: `${userId}@example.invalid`,
  });
  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      title: "Test Plan",
      raceType: "Ride",
      raceDate: addDaysYmd(WEEK_START, 90),
      startDate: WEEK_START,
      weeksTotal: 16,
      currentWeek: 1,
      status: "active",
      constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Bike"] },
    })
    .returning();
  const days = Array.from({ length: 7 }, (_, i) =>
    emptyDay(addDaysYmd(WEEK_START, i))
  );
  await db.insert(schema.weekPlans).values({
    userId,
    planId: plan.id,
    weekStart: WEEK_START,
    skeletonWeek: 1,
    days,
    status: "open",
  });
}

async function renderTrainWeekWithSheet(
  userId: string,
  sheet: string | undefined
): Promise<string> {
  requireUserMock.mockResolvedValue({
    id: userId,
    email: `${userId}@example.invalid`,
    name: "Test Athlete",
  });
  const { default: TrainPage } = await import("./page");
  const stream = await renderToReadableStream(
    <TrainPage searchParams={Promise.resolve({ sheet })} />
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

describe.skipIf(!hasDb)(
  "TrainPage: ?sheet= validates against TRAIN_SHEETS",
  () => {
    beforeAll(async () => {
      await seedOpenWeek(TEST_USER);
    });

    afterAll(async () => {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    it("renders no dialog at all when ?sheet= is absent", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, undefined);
      expect(html).not.toContain('role="dialog"');
    });

    it("renders no dialog for a sheet name outside TRAIN_SHEETS", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "drop-tables");
      expect(html).not.toContain('role="dialog"');
      // Never echoed back into the render unvalidated, the way an unparseable
      // day or activity id must never reach a query.
      expect(html).not.toContain("drop-tables");
    });

    it("renders the dialog for the one implemented sheet name", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "why-week");
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-label="Why this week"');
    });

    // A real TRAIN_SHEETS member (tasks 2-5's destinations, not yet
    // implemented) must not fall through to the one sheet this task built —
    // membership in TRAIN_SHEETS is necessary, not sufficient, to open
    // "why-week" specifically.
    it("renders no dialog for a valid-but-unimplemented sheet name", async () => {
      const html = await renderTrainWeekWithSheet(TEST_USER, "plan-setup");
      expect(html).not.toContain('role="dialog"');
    });
  }
);
