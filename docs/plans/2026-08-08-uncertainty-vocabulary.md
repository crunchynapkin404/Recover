# Uncertainty Vocabulary (Phase One) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared `Figure<T>`/`Unavailable` uncertainty type (Phase 2b.3), migrate the first real surface to it — fixing the correlation "limited evidence" vs "inconclusive" conflation the goal forbids — and write the descriptive design-system doc (Phase 2b.1).

**Architecture:** One new type module (`src/lib/uncertainty.ts`) with a discriminated `Figure<T>` (available vs three `Unavailable` kinds: `calibrating`, `missing_input`, `not_applicable`), promoted from the precedent already proven in `src/lib/race/demand.ts`. Two rendering primitives built on existing `src/components/ui/` pieces. One real surface (90-day correlations) migrated end-to-end as the flagship fix, locked in by a source-level guard test. A descriptive doc closes out 2b.1.

**Tech Stack:** TypeScript 5, React 19 server + client components, Vitest (`renderToString` from `react-dom/server` for component tests — no jsdom needed), Next.js 16.

Spec: `docs/specs/2026-08-08-uncertainty-vocabulary-design.md`. This is the
second of two plans from that spec (the first, telemetry, shipped as
v0.66.0) — but it only implements a **first slice** of the vocabulary's
migration. The spec's own "Risks" section calls the full migration "wide,
not deep... each `—` needs its call site read, not a bulk replace"; this
plan reads and fixes one surface for real, and lists the rest as a tracked
backlog (see Appendix) rather than pretending to script ~20 more file edits
blind. Phase 2b.2 (settle the IA) is explicitly out of scope — deferred
until on/after 2026-09-05 per that spec.

## Global Constraints

- **No new figures.** The vocabulary changes how existing numbers express
  themselves, never what they claim (spec's Non-goals).
- **No IA or visual-redesign changes here.** That's 2b.2/2b.4, separate cycles.
- **`Figure<T>` is bounded to athlete-facing numbers** — UI, coach context, or
  an MCP tool return — not every internal intermediate (spec's Risks: "could
  metastasise").
- **Retired dialect words stay as internal state names where they already are
  one.** E.g. `readiness.ts`'s `Band` union keeps the literal `"calibrating"` —
  only the athlete-facing _sentences_ built from these states are retired.
- **Test convention:** co-locate `<name>.test.ts(x)` beside its source file;
  render component tests with `renderToString` from `react-dom/server` (see
  `src/components/dashboard/readiness-rings.test.tsx`) — this repo's
  presentational components don't need jsdom. Whole-tree guard tests live in
  `tests/` (see `tests/plan-identity-single-producer.test.ts`), not `src/`.
- **Mutation-check the correlation split and the guard test** before marking
  Task 3/4 done (`docs/BASELINE.md`'s structural lesson #1): break the code,
  confirm the test fails, then restore it.
- **`src/components/journal/correlation-insights.tsx` is a confirmed orphan**
  (zero import sites anywhere in `src/` — verified 2026-08-08). It duplicates
  the same retired strings this plan fixes elsewhere, but Task 3 does **not**
  touch it: which cycle disposes of the 12 orphaned components is
  Phase 2b.2's decision (`docs/ROADMAP.md`), not this plan's. Task 4's guard
  test excludes it by name with a comment, rather than editing it.
- Run everything with Node 22 on PATH; none of this plan's tests touch the
  database, so no `.env` sourcing or `describe.skipIf(!hasDb)` is needed.

---

### Task 1: `src/lib/uncertainty.ts` — the shared type

**Files:**

- Create: `src/lib/uncertainty.ts`
- Test: `src/lib/uncertainty.test.ts`

**Interfaces:**

- Consumes: nothing (foundational).
- Produces: `type Confidence`, `type CalibratingUnit`, `type Unavailable`,
  `type Figure<T>`, and the value `Figure` with
  `Figure.available(value, confidence, why?)`,
  `Figure.calibrating(have, need, unit)`,
  `Figure.missingInput(needs, fix?)`, `Figure.notApplicable(why)`. Tasks 2
  and 3 import `Figure` (both the type and the value) from
  `@/lib/uncertainty`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/uncertainty.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Figure } from "./uncertainty";
import type { Figure as FigureT } from "./uncertainty";

describe("Figure", () => {
  it("available() carries a value and confidence", () => {
    const f = Figure.available(42, "high");
    expect(f.available).toBe(true);
    if (f.available) {
      expect(f.value).toBe(42);
      expect(f.confidence).toBe("high");
      expect(f.why).toBeUndefined();
    }
  });

  it("available() carries an optional why", () => {
    const f = Figure.available(7, "medium", "estimated from FTP");
    expect(f.available && f.why).toBe("estimated from FTP");
  });

  it("calibrating() carries have/need/unit and no value", () => {
    const f: FigureT<number> = Figure.calibrating(4, 14, "days");
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.kind).toBe("calibrating");
      expect(f.have).toBe(4);
      expect(f.need).toBe(14);
      expect(f.unit).toBe("days");
    }
  });

  it("missingInput() carries needs and an optional fix link", () => {
    const f: FigureT<number> = Figure.missingInput("FTP", {
      label: "Set FTP",
      href: "/settings",
    });
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.kind).toBe("missing_input");
      expect(f.needs).toBe("FTP");
      expect(f.fix).toEqual({ label: "Set FTP", href: "/settings" });
    }
  });

  it("missingInput() allows no fix link", () => {
    const f: FigureT<number> = Figure.missingInput("a race date");
    expect(!f.available && f.fix).toBeUndefined();
  });

  it("notApplicable() carries a reason", () => {
    const f: FigureT<number> = Figure.notApplicable("no race scheduled");
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.kind).toBe("not_applicable");
      expect(f.why).toBe("no race scheduled");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/uncertainty.test.ts`
Expected: FAIL — cannot find module `./uncertainty`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/uncertainty.ts`:

```ts
/**
 * Shared "does the app know this, and how well" type for athlete-facing
 * numbers (UI, coach context, MCP tool returns) — see
 * docs/specs/2026-08-08-uncertainty-vocabulary-design.md. Promotes the
 * discriminated-union shape src/lib/race/demand.ts's EventDemandResult
 * already proved for one number to house style, so a caller cannot consume
 * an athlete-facing figure without handling the case where it isn't one.
 */

export type Confidence = "low" | "medium" | "high";

export type CalibratingUnit = "days" | "nights" | "sessions";

export type Unavailable =
  | { kind: "calibrating"; have: number; need: number; unit: CalibratingUnit }
  | {
      kind: "missing_input";
      needs: string;
      fix?: { label: string; href: string };
    }
  | { kind: "not_applicable"; why: string };

export type Figure<T> =
  | { available: true; value: T; confidence: Confidence; why?: string }
  | ({ available: false } & Unavailable);

export const Figure = {
  available: <T>(
    value: T,
    confidence: Confidence,
    why?: string
  ): Figure<T> => ({ available: true, value, confidence, why }),

  calibrating: (
    have: number,
    need: number,
    unit: CalibratingUnit
  ): Figure<never> => ({
    available: false,
    kind: "calibrating",
    have,
    need,
    unit,
  }),

  missingInput: (
    needs: string,
    fix?: { label: string; href: string }
  ): Figure<never> => ({ available: false, kind: "missing_input", needs, fix }),

  notApplicable: (why: string): Figure<never> => ({
    available: false,
    kind: "not_applicable",
    why,
  }),
};
```

Note: this is a plain `.ts` file (not `.tsx`), so the generic arrow
`<T,>(...)` doesn't need the disambiguating trailing comma — it's kept here
only for consistency; either form compiles.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/uncertainty.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/lib/uncertainty.ts src/lib/uncertainty.test.ts
git commit -m "feat(uncertainty): add the shared Figure<T> type"
```

---

### Task 2: Rendering primitives — `<ConfidenceChip>` and `<Unavailable>`

**Files:**

- Create: `src/components/ui/confidence-chip.tsx`
- Test: `src/components/ui/confidence-chip.test.tsx`
- Create: `src/components/ui/unavailable.tsx`
- Test: `src/components/ui/unavailable.test.tsx`

**Interfaces:**

- Consumes: `Confidence`, `Unavailable` (type) from `@/lib/uncertainty` (Task 1).
- Produces: `ConfidenceChip({ level }: { level: Confidence })`;
  `Unavailable({ state, full? }: { state: UncertaintyUnavailable; full?: boolean })`;
  `unavailableMessage(state): string`. Task 3 imports `unavailableMessage`
  from `@/components/ui/unavailable`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/confidence-chip.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ConfidenceChip } from "./confidence-chip";

describe("ConfidenceChip", () => {
  it("renders a label for low confidence", () => {
    const html = renderToString(<ConfidenceChip level="low" />);
    expect(html).toContain("Low confidence");
  });

  it("renders a label for medium confidence", () => {
    const html = renderToString(<ConfidenceChip level="medium" />);
    expect(html).toContain("Medium confidence");
  });

  it("renders nothing at high confidence", () => {
    const html = renderToString(<ConfidenceChip level="high" />);
    expect(html).toBe("");
  });
});
```

Create `src/components/ui/unavailable.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Unavailable, unavailableMessage } from "./unavailable";

describe("unavailableMessage", () => {
  it("phrases calibrating as day N of M", () => {
    expect(
      unavailableMessage({
        kind: "calibrating",
        have: 4,
        need: 14,
        unit: "days",
      })
    ).toBe("Calibrating — day 4 of 14 days");
  });

  it("phrases missing_input as a need", () => {
    expect(unavailableMessage({ kind: "missing_input", needs: "an FTP" })).toBe(
      "Needs an FTP"
    );
  });

  it("phrases not_applicable as its reason verbatim", () => {
    expect(
      unavailableMessage({ kind: "not_applicable", why: "no race scheduled" })
    ).toBe("no race scheduled");
  });
});

describe("Unavailable", () => {
  it("renders inline by default", () => {
    const html = renderToString(
      <Unavailable
        state={{ kind: "calibrating", have: 4, need: 14, unit: "days" }}
      />
    );
    expect(html).toContain("day 4 of 14 days");
    expect(html).not.toContain("empty-state");
  });

  it("renders a fix link for missing_input when provided", () => {
    const html = renderToString(
      <Unavailable
        state={{
          kind: "missing_input",
          needs: "an FTP",
          fix: { label: "Set FTP", href: "/settings" },
        }}
      />
    );
    expect(html).toContain("Needs an FTP");
    expect(html).toContain("Set FTP");
    expect(html).toContain('href="/settings"');
  });

  it("renders the full empty-state treatment when full is set", () => {
    const html = renderToString(
      <Unavailable
        state={{ kind: "not_applicable", why: "no race scheduled" }}
        full
      />
    );
    expect(html).toContain("no race scheduled");
    expect(html).toContain('data-slot="empty-state"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ui/confidence-chip.test.tsx src/components/ui/unavailable.test.tsx`
Expected: FAIL — cannot find modules `./confidence-chip`, `./unavailable`.

- [ ] **Step 3: Write the implementation**

Create `src/components/ui/confidence-chip.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import type { Confidence } from "@/lib/uncertainty";

const LABEL: Record<"low" | "medium", string> = {
  low: "Low confidence",
  medium: "Medium confidence",
};

/** Nothing renders at high confidence — that is the unmarked default. */
export function ConfidenceChip({ level }: { level: Confidence }) {
  if (level === "high") return null;
  return (
    <Badge variant="outline" data-slot="confidence-chip">
      {LABEL[level]}
    </Badge>
  );
}
```

Create `src/components/ui/unavailable.tsx`:

```tsx
import Link from "next/link";
import { CircleDashed } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Unavailable as UnavailableState } from "@/lib/uncertainty";

export function unavailableMessage(state: UnavailableState): string {
  switch (state.kind) {
    case "calibrating":
      return `Calibrating — day ${state.have} of ${state.need} ${state.unit}`;
    case "missing_input":
      return `Needs ${state.needs}`;
    case "not_applicable":
      return state.why;
  }
}

/** Inline by default; pass `full` for a full-panel empty-state treatment. */
export function Unavailable({
  state,
  full = false,
}: {
  state: UnavailableState;
  full?: boolean;
}) {
  const text = unavailableMessage(state);
  const fix = state.kind === "missing_input" ? state.fix : undefined;

  if (full) {
    return <EmptyState icon={CircleDashed} message={text} />;
  }

  return (
    <span data-slot="unavailable" className="text-white/50">
      {text}
      {fix && (
        <>
          {" "}
          <Link href={fix.href} className="underline">
            {fix.label}
          </Link>
        </>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ui/confidence-chip.test.tsx src/components/ui/unavailable.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/components/ui/confidence-chip.tsx src/components/ui/confidence-chip.test.tsx \
  src/components/ui/unavailable.tsx src/components/ui/unavailable.test.tsx
git commit -m "feat(uncertainty): add ConfidenceChip and Unavailable primitives"
```

---

### Task 3: Fix the correlation "limited evidence" vs "inconclusive" conflation

**Context:** `src/lib/insights/correlations.ts` already computes
`evidence: "limited" | "strong"` per tag (limited = fewer than 10 tagged
days, or the CI half-width swamps the impact). Today both non-conclusive
cases render through the same grey, muted style with only the label text
differing — the goal's "when it does not know, it says so" is violated by
treatment, not just wording: a confident finding of no effect should not
look like missing data.

**Files:**

- Modify: `src/lib/insights/correlations.ts`
- Modify: `src/lib/insights/correlations.test.ts`
- Modify: `src/components/body/correlation-rows.tsx`
- Create: `src/components/body/correlation-rows.test.tsx`

**Interfaces:**

- Consumes: `Figure` (type + value) from `@/lib/uncertainty` (Task 1);
  `unavailableMessage` from `@/components/ui/unavailable` (Task 2).
- Produces: `MIN_EVENTS_FOR_EVIDENCE`, `CorrelationFinding`,
  `correlationFigure(insight): Figure<CorrelationFinding>` from
  `src/lib/insights/correlations.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/insights/correlations.test.ts` (new `describe` block,
alongside the existing `correlateTags` one). The file already has
`import { correlateTags } from "./correlations";` — change that line to:

```ts
import {
  correlateTags,
  correlationFigure,
  MIN_EVENTS_FOR_EVIDENCE,
} from "./correlations";
```

Then add the new block below the existing `describe("correlateTags", ...)`:

```ts
describe("correlationFigure", () => {
  const base = { impactPct: 2, ciHalfWidthPct: 8 };

  it("is an available, high-confidence finding when evidence is strong", () => {
    const f = correlationFigure({
      ...base,
      conclusive: false,
      evidence: "strong",
      events: 30,
    });
    expect(f.available).toBe(true);
    if (f.available) {
      expect(f.value.noEffect).toBe(true);
      expect(f.confidence).toBe("high");
    }
  });

  it("carries the effect through when evidence is strong and conclusive", () => {
    const f = correlationFigure({
      impactPct: -25,
      ciHalfWidthPct: 5,
      conclusive: true,
      evidence: "strong",
      events: 12,
    });
    expect(f.available && f.value.noEffect).toBe(false);
    expect(f.available && f.value.impactPct).toBe(-25);
  });

  it("is calibrating, not a finding, when evidence is limited", () => {
    const f = correlationFigure({
      ...base,
      conclusive: false,
      evidence: "limited",
      events: 3,
    });
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.kind).toBe("calibrating");
      expect(f.have).toBe(3);
      expect(f.need).toBe(MIN_EVENTS_FOR_EVIDENCE);
      expect(f.unit).toBe("days");
    }
  });
});
```

Create `src/components/body/correlation-rows.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CorrelationRows } from "./correlation-rows";
import type { TagInsight } from "@/lib/insights/correlations";

function insight(overrides: Partial<TagInsight>): TagInsight {
  return {
    emoji: "🍷",
    behavior: "Alcohol",
    auto: false,
    impactPct: -25,
    ciHalfWidthPct: 5,
    conclusive: true,
    events: 12,
    evidence: "strong",
    splits: { weekday: null, weekend: null },
    ...overrides,
  };
}

describe("CorrelationRows", () => {
  it("renders a conclusive effect in color", () => {
    const html = renderToString(
      <CorrelationRows
        insights={[insight({ conclusive: true, impactPct: -25 })]}
      />
    );
    expect(html).toContain("25% ± 5 next-day");
    expect(html).toContain("text-red-400");
  });

  it("renders strong evidence with no effect as a finding, not as unavailable", () => {
    const html = renderToString(
      <CorrelationRows
        insights={[
          insight({ conclusive: false, evidence: "strong", events: 30 }),
        ]}
      />
    );
    expect(html).toContain("No detectable effect");
  });

  it("renders limited evidence as calibrating, not as a finding", () => {
    const html = renderToString(
      <CorrelationRows
        insights={[
          insight({ conclusive: false, evidence: "limited", events: 3 }),
        ]}
      />
    );
    expect(html).toContain("Calibrating");
    expect(html).not.toContain("No detectable effect");
  });

  it("the two non-conclusive cases must not read alike", () => {
    const noEffect = renderToString(
      <CorrelationRows
        insights={[
          insight({ conclusive: false, evidence: "strong", events: 30 }),
        ]}
      />
    );
    const calibrating = renderToString(
      <CorrelationRows
        insights={[
          insight({ conclusive: false, evidence: "limited", events: 3 }),
        ]}
      />
    );
    expect(noEffect).not.toContain("text-white/40");
    expect(calibrating).toContain("text-white/40");
  });

  it("never renders the retired 'limited evidence' or 'inconclusive' strings", () => {
    const html = renderToString(
      <CorrelationRows
        insights={[
          insight({ conclusive: false, evidence: "strong", events: 30 }),
          insight({ conclusive: false, evidence: "limited", events: 3 }),
        ]}
      />
    );
    expect(html).not.toContain("inconclusive");
    expect(html).not.toContain("limited evidence");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/insights/correlations.test.ts src/components/body/correlation-rows.test.tsx`
Expected: FAIL — `correlationFigure`/`MIN_EVENTS_FOR_EVIDENCE` not exported;
`CorrelationRows` still renders the old strings.

- [ ] **Step 3: Implement — `correlations.ts`**

Change the top of `src/lib/insights/correlations.ts` from:

```ts
export const MIN_EVENTS = 5;
export const WINDOW_DAYS = 90;
```

to:

```ts
import { Figure } from "@/lib/uncertainty";

export const MIN_EVENTS = 5;
export const WINDOW_DAYS = 90;
/** Events below this still get a headline row, but as calibrating, not a finding. */
export const MIN_EVENTS_FOR_EVIDENCE = 10;
```

Change the `compare()` function's evidence line from:

```ts
    evidence:
      tagged.length < 10 || ciHalfWidthPct >= Math.abs(impactPct)
        ? "limited"
        : "strong",
```

to (same logic, now naming the constant it actually used):

```ts
    evidence:
      tagged.length < MIN_EVENTS_FOR_EVIDENCE || ciHalfWidthPct >= Math.abs(impactPct)
        ? "limited"
        : "strong",
```

Add near the bottom of the file (after `correlateTags`, before
`computeTagInsights`):

```ts
export interface CorrelationFinding {
  impactPct: number;
  ciHalfWidthPct: number;
  /** True when the CI includes zero: a real finding of no effect, not a missing one. */
  noEffect: boolean;
}

interface EvidenceFields {
  impactPct: number;
  ciHalfWidthPct: number;
  conclusive: boolean;
  events: number;
  evidence: "limited" | "strong";
}

/**
 * Maps the conclusive/evidence fields to the shared uncertainty vocabulary:
 * a thin sample is `calibrating` (more tagged days will resolve it); a
 * strong-but-null sample is an `available`, high-confidence finding of no
 * effect — the distinction correlation-rows.tsx used to render identically.
 */
export function correlationFigure(
  insight: EvidenceFields
): Figure<CorrelationFinding> {
  if (insight.evidence === "limited") {
    return Figure.calibrating(insight.events, MIN_EVENTS_FOR_EVIDENCE, "days");
  }
  return Figure.available(
    {
      impactPct: insight.impactPct,
      ciHalfWidthPct: insight.ciHalfWidthPct,
      noEffect: !insight.conclusive,
    },
    "high"
  );
}
```

- [ ] **Step 4: Implement — `correlation-rows.tsx`**

Replace the file's contents with:

```tsx
import type { TagInsight } from "@/lib/insights/correlations";
import { correlationFigure } from "@/lib/insights/correlations";
import { unavailableMessage } from "@/components/ui/unavailable";

/**
 * Behaviour correlations as plain rows (1g) — the same numbers the v0.9.4
 * card carried, without the nested glass. A thin sample renders as
 * calibrating; a strong sample with no effect renders as a real finding —
 * they must not read alike (docs/specs/2026-08-08-uncertainty-vocabulary-design.md).
 */
export function CorrelationRows({ insights }: { insights: TagInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <section className="mb-3 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <h3 className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
        90-day correlations
      </h3>
      <ul>
        {insights.map((c) => (
          <li
            key={`${c.emoji}${c.behavior}`}
            className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0"
          >
            <span className="flex min-w-0 items-center gap-2 text-[12px] text-white/85">
              <span aria-hidden>{c.emoji}</span>
              <span className="truncate capitalize">{c.behavior}</span>
              {c.auto && (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-white/30">
                  auto
                </span>
              )}
            </span>
            <CorrelationBadge insight={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CorrelationBadge({ insight: c }: { insight: TagInsight }) {
  const figure = correlationFigure(c);

  if (!figure.available) {
    return (
      <span className="shrink-0 text-[11px] text-white/40">
        {unavailableMessage(figure)} · {c.events} events
      </span>
    );
  }

  if (figure.value.noEffect) {
    return (
      <span className="shrink-0 text-[11.5px] font-medium text-white/70">
        No detectable effect · {c.events} events
      </span>
    );
  }

  return (
    <span
      className={`shrink-0 text-[11.5px] font-bold ${
        figure.value.impactPct > 0 ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {figure.value.impactPct > 0 ? "+" : "−"}
      {Math.abs(figure.value.impactPct)}% ± {figure.value.ciHalfWidthPct}{" "}
      next-day
    </span>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/insights/correlations.test.ts src/components/body/correlation-rows.test.tsx`
Expected: PASS, all tests including the existing `correlateTags` suite.

- [ ] **Step 6: Mutation-check the fix**

Temporarily change `noEffect: !insight.conclusive` to `noEffect: false` in
`correlationFigure` and re-run
`npx vitest run src/components/body/correlation-rows.test.tsx` — the "renders
strong evidence with no effect as a finding" test must fail. Revert the
change once confirmed.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/lib/insights/correlations.ts src/lib/insights/correlations.test.ts \
  src/components/body/correlation-rows.tsx src/components/body/correlation-rows.test.tsx
git commit -m "fix(insights): stop rendering 'no effect' and 'not enough data' alike"
```

---

### Task 4: Guard test — the retired strings never come back

**Files:**

- Create: `tests/uncertainty-dialects-guard.test.ts`

**Interfaces:**

- Consumes: nothing (scans the `src/` tree as text).
- Produces: nothing importable — a standalone regression test.

- [ ] **Step 1: Write the test**

Create `tests/uncertainty-dialects-guard.test.ts`:

```ts
// tests/uncertainty-dialects-guard.test.ts — regression guard for the
// correlation-evidence conflation docs/specs/2026-08-08-uncertainty-vocabulary-design.md
// and docs/plans/2026-08-08-uncertainty-vocabulary.md (Task 3) fixed.
//
// "limited evidence" (not enough tagged days —
// src/lib/insights/correlations.ts's evidence: "limited") and "inconclusive"
// (a real, high-confidence finding of no effect) used to render identically.
// correlationFigure() now maps the first to Figure.calibrating(...) and the
// second to Figure.available(..., "high"), and correlation-rows.tsx was
// rewritten to use it. This guard fails if either literal string returns
// anywhere outside a test file.
//
// This list is deliberately NOT all six retired dialects from the spec's
// table yet — only the two this plan's Task 3 actually fixed. It grows one
// migrated surface at a time; do not add an unmigrated phrase here, or this
// guard fails permanently until that surface's own fix lands.
//
// KNOWN EXCEPTION: src/components/journal/correlation-insights.tsx has no
// render site anywhere in src/ (confirmed 2026-08-08) and duplicates the
// same retired strings. It is excluded here rather than fixed — which cycle
// disposes of the app's 12 orphaned components is Phase 2b.2's decision
// (docs/ROADMAP.md), not this plan's.
//
// KNOWN LIMITATION: this is a literal substring match. It catches the
// realistic reintroduction (a copy-pasted ternary) but not one built through
// indirection (string concatenation, a template literal split across
// lines). Treat a pass as evidence against the common case, not proof.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const SRC_ROOT = join(REPO_ROOT, "src");

const RETIRED_PHRASES = ["limited evidence", "inconclusive"];

const KNOWN_ORPHANS = new Set([
  join(SRC_ROOT, "components/journal/correlation-insights.tsx"),
]);

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      walkSourceFiles(full, out);
      continue;
    }
    const ext = extname(entry);
    if (ext !== ".ts" && ext !== ".tsx") continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    out.push(full);
  }
  return out;
}

describe("retired correlation-evidence dialects", () => {
  it("never reappear outside a test file", () => {
    const offenders: string[] = [];
    for (const file of walkSourceFiles(SRC_ROOT)) {
      if (KNOWN_ORPHANS.has(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const phrase of RETIRED_PHRASES) {
        if (text.includes(phrase)) offenders.push(`${file}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — should already pass**

Run: `npx vitest run tests/uncertainty-dialects-guard.test.ts`
Expected: PASS (Task 3 already removed both strings from the one live file
that had them).

- [ ] **Step 3: Mutation-check the guard**

Temporarily add `const _x = "inconclusive";` to
`src/components/body/correlation-rows.tsx`, re-run the guard test — it must
fail and name that file. Remove the line once confirmed.

- [ ] **Step 4: Commit**

```bash
git add tests/uncertainty-dialects-guard.test.ts
git commit -m "test(uncertainty): guard against the retired evidence-dialect strings"
```

---

### Task 5: `docs/design-system.md` (Phase 2b.1)

**Files:**

- Create: `docs/design-system.md`

**Interfaces:**

- Consumes: the token list in `src/app/globals.css`, the primitive inventory
  in `src/components/ui/` (now 16 files after Task 2), the `SURFACES` tuple
  in `src/lib/telemetry.ts`, `NAV_ITEMS` in `src/components/sidebar-nav.tsx`,
  and the vocabulary from Tasks 1–3.
- Produces: `docs/design-system.md` (descriptive doc, no exports).

- [ ] **Step 1: Write the doc**

Create `docs/design-system.md`:

```markdown
# Design system — as built

Descriptive, not prescriptive: what exists at this commit. Phase 2b.1
(`docs/ROADMAP.md`). Living — Phase 2c's number slices push small deltas
back into this file as they land; it is not re-derived from scratch.

The artifact v0.21 and v0.23 were each supposed to leave behind and neither
did (`.superdesign/` is empty).

## Tokens

83 CSS custom properties in `src/app/globals.css`, one dark theme (no light
mode — "Dark-first: the only theme"). Grouped:

| Group        | Tokens                                                                                                                                     | Example                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Core surface | `--background`, `--foreground`, `--card`, `--popover`                                                                                      | `--background: #0a0a0a`           |
| Semantic     | `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive` (+ their `-foreground` pairs)                                           | `--primary: #10b981`              |
| Border/ring  | `--border`, `--input`, `--ring`                                                                                                            | `--border: rgba(255,255,255,0.1)` |
| Charts       | `--chart-1` … `--chart-5`                                                                                                                  | `--chart-2: #10b981`              |
| Sidebar      | `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring` (+ `-foreground` pairs) | `--sidebar: #121212`              |
| Radius       | `--radius` + 6 derived scales (`sm` → `4xl`)                                                                                               | `--radius: 1rem`                  |

`@theme inline` remaps most of these to Tailwind's `--color-*`/`--radius-*`
namespace for utility classes; the glassmorphic look layers translucent
white (`bg-white/5`, `border-white/10`) on top rather than its own tokens.

## Primitives (`src/components/ui/`)

16 files: `badge`, `bottom-sheet`, `button`, `card`, `collapsible`,
`confidence-chip`, `empty-state`, `hero-card`, `inline-markdown`, `input`,
`label`, `separator`, `skeleton`, `sonner`, `tabs`, `unavailable`. The last
two are the uncertainty-vocabulary primitives added alongside this doc
(`docs/plans/2026-08-08-uncertainty-vocabulary.md`).

## IA — as built

Two navs, same 5 routes, never both visible (`SidebarNav` is `lg:` only,
`BottomNav` is `lg:hidden`):

| Route       | Label | Icon          |
| ----------- | ----- | ------------- |
| `/`         | Today | Clock         |
| `/train`    | Train | CalendarRange |
| `/coach`    | Coach | Sparkles      |
| `/body`     | Body  | Activity      |
| `/settings` | Menu  | Settings2     |

`src/lib/telemetry.ts`'s `SURFACES` — the full closed set of authenticated
pages, including ones reached by drilling in rather than from the nav —
is wider: `today`, `train`, `coach`, `body`, `settings`, `admin`, `import`,
`activity`, `activity-log`. `admin`, `import`, `activity` and `activity-log`
have no nav entry of their own.

Whether this is the right shape is Phase 2b.2's question, deferred until
four weeks of `surface_views` data exists (on or after 2026-09-05).

## Uncertainty vocabulary

`src/lib/uncertainty.ts` (Phase 2b.3, first slice —
`docs/plans/2026-08-08-uncertainty-vocabulary.md`). A number's owner returns
`Figure<T>`:

- `{ available: true, value, confidence, why? }` — confidence is
  `"low" | "medium" | "high"`; `<ConfidenceChip>` renders anything below
  `"high"`, nothing at `"high"`.
- `{ available: false, ...Unavailable }` — one of three kinds, rendered by
  `<Unavailable>` (inline by default, `full` for an empty-panel treatment):
  - `calibrating` — machinery works, history is short, resolves itself.
    Carries `have`/`need`/`unit`.
  - `missing_input` — a required input is absent and won't arrive alone.
    Carries `needs` and an optional `fix` link.
  - `not_applicable` — does not apply here. Carries `why`.

**Migrated so far:** the 90-day correlation rows
(`src/components/body/correlation-rows.tsx`) — the surface where
"limited evidence" (calibrating) and "inconclusive" (a real finding of no
effect) used to render identically.

**Still on the six-dialect strings, not yet migrated:** the em-dash
placeholder (`—`), the `calibrating` label text on the readiness hero/rings/
race-countdown/day-actions/morning-insight/coach-context, `insufficient`
(bio-age, race forecast, race-countdown), bare `unknown` copy, `no data`/
`not enough data` (body battery, PMC chart, wellness trends), and the
ad-hoc `· limited data` (sleep debt). Tracked as a backlog, not a task, in
`docs/plans/2026-08-08-uncertainty-vocabulary.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/design-system.md
git commit -m "docs: describe the design system as built (Phase 2b.1)"
```

---

### Task 6: Release housekeeping

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:** Consumes: the diff from Tasks 1–5. Produces: nothing
importable.

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.66.0"` to `"version": "0.67.0"`.

- [ ] **Step 2: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, above the existing `## v0.66.0` entry:

```markdown
## v0.67.0 — 2026-08-08 — Uncertainty vocabulary (phase one)

Phase 2b.1, and the first slice of 2b.3: a shared type for "the app doesn't
know" states, and the first surface migrated to it.

- Added `src/lib/uncertainty.ts`: `Figure<T>`, `Unavailable` and
  `Confidence`, with `Figure.available/.calibrating/.missingInput/.notApplicable`
  constructors — the discriminated-union shape `src/lib/race/demand.ts`
  already proved for one number, promoted to house style.
- Added two rendering primitives on top of existing `src/components/ui/`
  pieces: `<ConfidenceChip>` (a badge for below-high confidence) and
  `<Unavailable>` (inline or full-panel empty state).
- Fixed the 90-day correlation rows' conflation the goal forbids: "limited
  evidence" (not enough tagged days) and "inconclusive" (a real,
  high-confidence finding of no effect) rendered identically. They now
  render as calibrating and as a real finding respectively, and a guard
  test fails if either retired string returns.
- Added `docs/design-system.md`: a descriptive catalog of the 83 tokens in
  `globals.css`, the 16 `src/components/ui/` primitives, and the IA as
  built.
- No new figures, no IA changes — Phase 2's constraint holds. The remaining
  five dialects and roughly 20 other call sites are unmigrated; tracked as a
  backlog in `docs/plans/2026-08-08-uncertainty-vocabulary.md`, not this
  release.
```

- [ ] **Step 3: Tick the roadmap**

In `docs/ROADMAP.md`, change:

```markdown
- [ ] **2b.1 — Document what exists.** A descriptive `docs/design-system.md`:
```

to:

```markdown
- [x] **2b.1 — Document what exists (v0.67.0).** A descriptive `docs/design-system.md`:
```

Leave 2b.3's checkbox unchecked (only one of six dialects is migrated) but
add a status note in the same inline style 2b.2 already uses. Change:

```markdown
- [ ] **2b.3 — Uncertainty and confidence language.** One vocabulary replacing
      six, distinguishing at least: _calibrating_ (not enough history yet),
      _insufficient_ (a required input is missing), _low confidence_ (wide
      interval), and _no figure plus the reason_ (the pattern v0.46 set for
      event demand). A token and a treatment for each. **2c consumes this.**
```

to:

```markdown
- [ ] **2b.3 — Uncertainty and confidence language.** One vocabulary replacing
      six, distinguishing at least: _calibrating_ (not enough history yet),
      _insufficient_ (a required input is missing), _low confidence_ (wide
      interval), and _no figure plus the reason_ (the pattern v0.46 set for
      event demand). A token and a treatment for each. **2c consumes this.**
      **v0.67.0** shipped `src/lib/uncertainty.ts`, its rendering primitives,
      and migrated the first surface (90-day correlations). Five dialects
      and roughly 20 other call sites remain — backlog in
      `docs/plans/2026-08-08-uncertainty-vocabulary.md`.
```

- [ ] **Step 4: Run the full local gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Expected: all green. (No `drizzle-kit generate` check needed — this plan
adds no schema changes.)

- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md docs/ROADMAP.md
git commit -m "chore(release): v0.67.0 — uncertainty vocabulary, phase one"
```

Do **not** merge, tag, or push — leave that decision to whoever requested
this plan, per `docs/RELEASING.md`.

---

## Appendix: migration backlog (not this plan's tasks)

The spec's six dialects, minus the one surface Task 3 migrated. Each needs
its call site read individually (spec's Risks section) — grouped here by
surface for whoever picks up the next slice. Not detailed as tasks because
the correct fix at each site depends on reading it, not a pattern that can
be pre-scripted blind.

**Dashboard / Today** (`src/app/page.tsx`, `src/components/dashboard/hero-readiness.tsx`,
`src/components/dashboard/readiness-rings.tsx`, `src/components/dashboard/race-countdown.tsx`,
`src/components/dashboard/milestones-card.tsx`, `src/components/today/today-hero.tsx`,
`src/components/today/checkin-sheet.tsx`) — em-dash placeholders for HRV/RHR/sleep/TSB/
readiness, the `"Calibrating · learning baseline"` label, `"Form outlook still
calibrating"`, the `"insufficient"` race-outlook kind, `"· limited data"` sleep-debt suffix.

**Train** (`src/app/train/page.tsx`, `src/components/train/season-timeline-card.tsx`,
`src/components/plan/day-actions.tsx`) — CTL/ATL/TSB em-dashes, `"calibrating"` display
text, `"No projection — calibrating."`, `"unknown"` target-load label.

**Body / Health** (`src/components/health/bio-age-card.tsx`, `src/components/body/labs-tiles.tsx`,
`src/lib/biological-age.ts`, `src/lib/race/forecast.ts`, `src/components/dashboard/body-battery.tsx`) —
`insufficient` bio-age/forecast kinds, "Not enough data yet" body-battery empty state.

**Log / Activity** (`src/components/log/pmc-chart.tsx`, `src/components/log/wellness-trends.tsx`,
`src/components/activity/laps-table.tsx`) — "Not enough data" chart empty states, lap-table
em-dash fallbacks.

**Coach / Journal** (`src/lib/morning-insight.ts`, `src/lib/coach-context.ts`,
`src/components/journal/journal-form.tsx`) — three "calibrating"/"not enough data" coach
sentences, journal rating em-dash.

**Admin / misc** (`src/components/admin/security-events.tsx`, `src/components/coach/artifact-card.tsx`,
`src/components/health/health-upload.tsx`) — em-dash fallbacks.

**Confirmed dead, not in scope for migration at all:**
`src/components/journal/correlation-insights.tsx` (zero render sites — see
Global Constraints). Its disposal belongs to Phase 2b.2's orphan cleanup.
