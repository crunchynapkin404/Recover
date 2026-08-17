# v0.106.0 — 2b.4 slice 5 phase B, the Settings redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Settings from 86 confirmed axe nodes to zero by migrating all 16
of its files onto the v0.99 foundations — the seven-step type scale on a hard
12px floor, the four-step ink ramp, real per-theme surfaces — and re-pin both
guard ceilings on the way out.

**Architecture:** Three phases. Phase 1 adds the five connector tokens the
redesign needs, because a token that does not exist cannot be migrated onto.
Phase 2 extracts the shell that five near-identical connector cards duplicate,
as a pure refactor with no class changes, so phase 3 migrates that markup once
instead of five times. Phase 3 migrates section by section, then drives axe to
zero and re-pins the ratchet.

**Tech Stack:** Next.js 16.2.10 (App Router), React 19.2.4, Tailwind v4
(`@theme` tokens in `src/app/globals.css`), Vitest 4 + jsdom + `vitest-axe`,
Playwright via `scripts/verify-surfaces.ts`.

**Spec:** `docs/specs/2026-08-11-2b4-visual-redesign-design.md` (2b.4, the
design authority for every slice)
**Predecessor:** `docs/plans/2026-08-16-v0105-slice5-settings.md` (phase A,
shipped as v0.105.0 — capture widening, seeding, the honest baseline)
**Gate:** ships through `docs/RELEASING.md`'s RC → soak → promote.

---

## Global Constraints

- **Branch:** `v0.106-settings-redesign` off `main`.
- **The 12px floor is hard.** No `text-[Npx]` below 12px survives, and a value
  that cannot be lifted gets **deleted or restated**, not shrunk — see slice 4,
  which deleted a per-message timestamp rather than enlarge it.
- **`hairline` is never text.** It is dividers, borders and icon strokes only.
  `tests/type-scale-guard.test.ts` fails the build on `text-hairline`.
- **Dev never holds real connector credentials** (`docs/ENVIRONMENTS.md`).
- **Five green checks:** `npm test`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm run format:check`.
- **Light mode stays unreachable** (`forcedTheme="dark"`) until slice 9. Light
  values are still written and still guarded; nobody sees them yet.
- **Capture command** (production build from source against the soak DB — the
  RC image cannot serve this measurement, see phase A result):
  ```bash
  set -a; . ./.env; set +a
  SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- settings
  ```

---

## What is actually there, measured 2026-08-17

Sixteen files carry **291 class-site edits**. The handoff's "52 sub-floor
literals, 72 ad-hoc alphas, 18 components" undercounts all three; these are the
numbers this plan is built on.

| File                                               | lines | arbitrary type | ad-hoc ink | default scale |
| -------------------------------------------------- | ----: | -------------: | ---------: | ------------: |
| `src/app/settings/page.tsx`                        |   581 |             15 |         29 |             7 |
| `src/components/settings/strava-card.tsx`          |   243 |             10 |         23 |             8 |
| `src/components/settings/apple-health-card.tsx`    |   206 |             12 |         22 |             5 |
| `src/components/settings/body-prefs-card.tsx`      |   148 |              3 |         13 |             8 |
| `src/components/settings/whoop-card.tsx`           |   102 |              5 |         12 |             3 |
| `src/components/settings/oura-card.tsx`            |   115 |              5 |         10 |             4 |
| `src/components/settings/withings-card.tsx`        |   104 |              5 |          9 |             3 |
| `src/components/settings/notifications-card.tsx`   |   189 |              1 |          9 |             7 |
| `src/components/settings/llm-usage-card.tsx`       |    63 |              0 |          5 |             3 |
| `src/components/settings/ride-debrief-toggles.tsx` |    73 |              2 |          4 |             3 |
| `src/components/settings/intervals-card.tsx`       |   189 |              1 |          2 |             7 |
| `src/components/settings/webhooks-card.tsx`        |   218 |              0 |          2 |            11 |
| `src/components/settings/api-tokens-card.tsx`      |   155 |              0 |          0 |             8 |
| `src/components/settings/coach-card.tsx`           |   235 |              0 |          0 |             6 |
| `src/components/settings/llm-settings-card.tsx`    |   207 |              0 |          0 |             4 |
| `src/components/settings/sessions-card.tsx`        |   135 |              0 |          0 |             5 |
| **Total**                                          |       |         **59** |    **140** |        **92** |

**Three corrections to the recorded scope, each verified by grep:**

1. **Ad-hoc ink is 140, not 72.** The 72 counts only `text-white/N`. The guard's
   `ADHOC_INK` pattern (`src/lib/design/type-scale-patterns.ts`) also matches
   `bg-`, `border-`, `fill-`, `stroke-`, `ring-` and `divide-`, and Settings
   holds 68 more of those: 22 × `border-white/10`, 20 × `bg-white/5`,
   10 × `bg-white/10`, 9 × `border-white/5`, and a tail of seven.
2. **All 59 arbitrary sizes go, not just the 52 sub-floor ones.**
   `ARBITRARY_TYPE` matches any arbitrary size in px/rem/em, so the
   3 × `text-[12px]`, `text-[14px]`, `text-[13.5px]` and `text-[22px]` are
   offenders too — they just happen to sit on or above the floor.
3. **92 default-scale utilities are also in scope.** Coach, Body and Train are
   each at **zero** `text-xs`/`text-sm` after their slices; that is the standard
   those slices set. These 92 do not break the floor (Tailwind's `text-xs` is
   exactly 0.75rem) — but see the leading risk below, because they are not
   free.

**Settings holds over half the app's remaining debt of both guarded kinds:**
59 of 112 arbitrary sizes and 140 of 267 ad-hoc ink occurrences src-wide. Both
`OFFENDER_CEILINGS` entries get force-re-pinned by this slice; the drops
(112 → 53 and 267 → 127) are far past `RATCHET_SLACK` of 25.

### The leading risk, stated up front

The semantic steps are declared as bare `--text-*` values in `@theme` with **no
paired `--text-*--line-height`**. Tailwind's `text-sm` sets font-size _and_
line-height (`0.875rem` / `1.25rem`); `text-caption` sets font-size only and
inherits leading. So the 92 default-scale renames are **not** pixel-identical
— they change vertical rhythm even where the font-size is unchanged. Slices 1–4
made the same swap across Coach, Body and Train and survived it, so the fix is
not to avoid the swap but to **look at the screenshots**, which Task 11 does.

### The baseline this must drive to zero

From `docs/axe-baseline-2026-08-11-seeded.md` — 86 confirmed nodes, all
`color-contrast`, all light-mode:

| Surface                   | light/phone | light/desktop | dark |
| ------------------------- | ----------: | ------------: | ---: |
| `settings`                |          10 |            11 |    0 |
| `settings-expanded`       |          11 |            11 |    0 |
| `settings-connect-errors` |          11 |            11 |    0 |
| `settings-token-created`  |          10 |            11 |    0 |

---

## Three decisions taken before starting

Recorded here rather than discovered mid-task, because slices 2 and 4 each hit
an editorial decision they had to stop and take.

### D1: the Connect CTA becomes `accent`; brand colour survives in the avatar chip only

The five connector cards each paint their Connect button as a solid brand block
with black ink — `bg-orange-500 text-black` (Strava), `bg-white text-black`
(Whoop), `bg-teal-400` (Withings), `bg-sky-400` (Oura), `bg-red-400` (Apple
Health). Every one of those is a **dark-only value**: `bg-white text-black` is
invisible on a light page, and the four saturated-400/500 hues carry black ink
that fails on their own light-mode expressions.

Rather than mint five solid/on-solid token pairs for five buttons that all do
the same thing, **all five Connect CTAs become the accent button**, which
already has a verified per-theme expression: `#047857` light / `#10b981` dark,
with `--accent-foreground` `#ffffff` / `#000000`. Measured with the project's
own `contrastRatio()`: **5.48:1 light, 8.28:1 dark**.

The brand identity moves to where it belongs and already lives — the 40px
avatar chip — which keeps one ink/tint pair per provider (Task 1).

**This is an editorial change, not a mechanical one**, and it is the change most
likely to draw comment on review: five buttons stop being brand-coloured. The
argument for it is that "Connect" is the same action five times and the design
system already has a token for the primary action.

### D2: extract the connector shell first, as a pure refactor

`whoop-card.tsx` (102 lines) and `withings-card.tsx` (104 lines) are the same
component with different nouns — identical JSX for the wrapper, header row,
avatar, name, subtitle, the Sync/Disconnect pair, the Connect CTA, the
unconfigured badge and the status paragraph. `oura-card.tsx` matches it and
appends a token form; `strava-card.tsx` and `apple-health-card.tsx` match it and
append substantially more.

Migrating in place means making the same six class edits five times. Extracting
first — with **no class changes at all** in the extraction commit — means Task 5
migrates that markup once. It also means a mistake in the extraction shows up as
a test failure against unchanged markup, instead of being tangled with 30
simultaneous class edits during review.

### D3: `src/components/ui/button.tsx` is in scope; the other four primitives are not

Settings imports `button` (6 files), `card` (6), `badge` (5), `input` (5) and
`label` (5). `button.tsx:26` carries `text-[0.8rem]` on its `sm` variant — a
real `ARBITRARY_TYPE` offender that `tests/type-scale-guard.test.ts`'s own
comment deferred: _"Left for whichever slice migrates that shared component
next."_ That is this slice, and it is a 12.8px → 12px change (Task 10).

The other four primitives carry only Tailwind default-scale utilities, which are
**not** guard offenders. Changing them would repaint `admin` (147 confirmed
nodes), `import` (8) and `login` (4) — surfaces slices 7 and 8 own. That is the
cross-surface change `globals.css`'s own `@theme` comment says a slice is not
allowed to make. Leave them.

---

## The class mapping — the single source of truth for all 291 edits

Every task below refers to this table rather than restating it. Apply it
literally; where a step needs a judgement call the task says so explicitly.

### Type

| Current                                   | Becomes        | px before → after |
| ----------------------------------------- | -------------- | ----------------- |
| `text-[8px]`                              | `text-label`   | 8 → 12            |
| `text-[10px]`, `text-[10.5px]`            | `text-label`   | 10 → 12           |
| `text-[12px]`, `text-xs`                  | `text-label`   | 12 → 12           |
| `text-[13.5px]`, `text-[14px]`, `text-sm` | `text-caption` | 14 → 14           |
| `text-base`                               | `text-body`    | 16 → 16           |
| `text-xl`                                 | `text-title`   | 20 → 20           |
| `text-[22px]`                             | `text-heading` | 22 → 24           |

### Ink

| Current                                            | Becomes                 |
| -------------------------------------------------- | ----------------------- |
| `text-white` (no alpha)                            | `text-ink-primary`      |
| `text-white/80`, `text-white/70`                   | `text-ink-secondary`    |
| `text-white/60`, `/50`, `/45`, `/40`, `/35`, `/25` | `text-ink-muted`        |
| `text-red-400`, `text-red-300` (error text)        | `text-destructive-ink`  |
| `text-amber-300`, `text-amber-400` (warning text)  | `text-kind-warning-ink` |
| `text-orange-400` (warning text, not brand chrome) | `text-kind-warning-ink` |

`ink-muted` is the floor for any text: 4.77:1 dark, 4.72:1 light, worst-case.
Anything currently quieter than `/50` gets its quietness back from weight and
tracking, never from ink below the floor — that is the spec's rule for
micro-labels.

### Surfaces and borders

| Current                                                | Becomes                     |
| ------------------------------------------------------ | --------------------------- |
| `border-white/20`, `/10`, `/5`, `border-white/[0.08]`  | `border-hairline`           |
| `bg-white/10`, `bg-white/5`, `bg-white/[0.03]`         | `bg-surface-overlay`        |
| `bg-black/40`, `bg-black/30` (recessed `<pre>` blocks) | `bg-surface-base`           |
| `hover:bg-white/10`, `hover:bg-white/5`                | `hover:bg-surface-selected` |
| `bg-white` (no alpha)                                  | `bg-surface-raised`         |
| `.glass` on a card wrapper                             | **unchanged**               |

**Bare `text-white` and `bg-white` are in scope and no guard catches them.**
`ADHOC_INK` requires a `/N` alpha, so these eight sites match no pattern in the
build: `oura-card:84`, `api-tokens-card:102`, `whoop-card:77`, and
`body-prefs-card:64,76,103,115,129`. Raw `text-white` on a light ground is the
_exact_ defect still open on Today (`docs/axe-baseline-2026-08-11-seeded.md`),
which is why the per-task check greps below all carry `\b(text|bg)-white\b` —
the only reason Today's two nodes survived slice 1 is that nothing was looking
for them.

`.glass` stays. `--glass-border` is already `rgba(255,255,255,0.1)` in dark and
`var(--hairline)` in light, and Coach (9 uses), Body (25) and Train (17) all
kept it through their slices. Do not churn it.

---

## File structure

**Created:**

- `src/components/settings/connector-card.tsx` — the shell five connector cards
  share, plus the four button class constants they duplicate. One file, one
  responsibility: the chrome of a connector card. Tailwind v4 compiles class
  strings that appear as literals in source, so exported `const` class strings
  compile and are seen by the source-scanning guards exactly like inline ones.
- `src/components/settings/connector-card.test.tsx` — behaviour of the shell
  across its three action states.
- `src/components/settings/connector-card.a11y.test.tsx` — axe over the shell.

**Modified:** the 16 files in the scope table, plus:

- `src/app/globals.css` — five connector ink/tint pairs (Task 1).
- `tests/contrast-guard.test.ts` — the exact-pair-list assertion (Task 1).
- `tests/type-scale-guard.test.ts` — both `OFFENDER_CEILINGS` (Task 12).
- `src/components/ui/button.tsx` — one arbitrary size (Task 10).
- `docs/ROADMAP.md`, `CHANGELOG.md`, `package.json` (Task 12).

---

## Phase 1 — the vocabulary

### Task 1: Add the five connector ink/tint pairs

**Files:**

- Modify: `src/app/globals.css` — light block (~line 168, beside the
  `--kind-*` pairs) and dark block (~line 249)
- Modify: `tests/contrast-guard.test.ts:301-317`

**Interfaces:**

- Produces: utilities `text-connector-{strava,whoop,withings,oura,apple}-ink`
  and `bg-connector-{…}-tint`, consumed by Task 5.

The `-ink` / `-tint` suffixes are load-bearing: `roleOfToken()`
(`src/lib/design/tokens.ts`) classifies anything matching `(?:^|-)ink(?:-|$)`
as text, and `contrast-guard.test.ts`'s `inkTintPairs()` derives its pair list
by rewriting `-ink` to `-tint`. Naming them correctly is what makes them
guarded without writing a single new assertion.

- [ ] **Step 1: Make the pair-list assertion fail first**

`tests/contrast-guard.test.ts` line 301 pins the exact list of ink/tint pairs.
Add the five new names to it _before_ declaring the tokens, so the test fails
for the right reason:

```typescript
it("finds the twelve kind/connector/ghost/destructive pairs declared so far", () => {
  // Not a floor: this is the C1/I6 lesson (see the file header) applied
  // to a second list — if this count doesn't move when a pair is added
  // or removed, the derivation above is checking nothing. `destructive-
  // ink`/`-tint` (the chat error banner / dictation-active mic) joined
  // the original six Task 5 pairs without anyone editing the derivation
  // itself — only this expectation, which is the point. v0.106.0 added
  // the five connector-*-ink/tint pairs the same way.
  expect(pairs.map(([ink]) => ink).sort()).toEqual([
    "connector-apple-ink",
    "connector-oura-ink",
    "connector-strava-ink",
    "connector-whoop-ink",
    "connector-withings-ink",
    "destructive-ink",
    "ghost-ink",
    "kind-debrief-ink",
    "kind-monthly-ink",
    "kind-morning-ink",
    "kind-warning-ink",
    "kind-weekly-ink",
  ]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run tests/contrast-guard.test.ts -t "pairs declared so far"
```

Expected: FAIL — received array holds the seven existing names, not twelve.

- [ ] **Step 3: Declare the tokens in the light block**

In `src/app/globals.css`, immediately after the `--ghost-tint` line in the
light `:root` block (~line 170):

```css
/* Connector brands, as the 40px avatar chip on each Settings connector
     card. Ink-on-tint like the coach inbox kinds above, and for the same
     reason: the raw brand hues are dark-only values — Whoop's is literally
     #ffffff — and every one of them was painted as a solid button with
     black ink that cannot survive a light ground. v0.106.0 moved the
     Connect action itself onto --accent (one action, one token) and kept
     the brand here, where it identifies rather than instructs. Light takes
     the 800 step on a 100 tint; dark keeps the luminous 300/400 on a 950.
     Ratios are ink on its own tint, measured by contrast-guard.test.ts. */
--connector-strava-ink: #9a3412; /* 6.38:1 on its tint */
--connector-strava-tint: #ffedd5;
--connector-whoop-ink: #262626; /* 13.88:1 */
--connector-whoop-tint: #f5f5f5;
--connector-withings-ink: #115e59; /* 6.73:1 */
--connector-withings-tint: #ccfbf1;
--connector-oura-ink: #075985; /* 6.59:1 */
--connector-oura-tint: #e0f2fe;
--connector-apple-ink: #991b1b; /* 6.80:1 */
--connector-apple-tint: #fee2e2;
```

- [ ] **Step 4: Declare them in the dark block**

After `--ghost-tint` in `.dark` (~line 251):

```css
--connector-strava-ink: #fb923c; /* 6.92:1 on its tint */
--connector-strava-tint: #431407;
--connector-whoop-ink: #f5f5f5; /* 13.88:1 */
--connector-whoop-tint: #262626;
--connector-withings-ink: #5eead4; /* 9.78:1 */
--connector-withings-tint: #042f2e;
--connector-oura-ink: #7dd3fc; /* 8.32:1 */
--connector-oura-tint: #082f49;
--connector-apple-ink: #fca5a5; /* 8.51:1 */
--connector-apple-tint: #450a0a;
```

- [ ] **Step 5: Expose them as Tailwind utilities**

In the `@theme` block, after `--color-ghost-tint` (~line 71):

```css
--color-connector-strava-ink: var(--connector-strava-ink);
--color-connector-strava-tint: var(--connector-strava-tint);
--color-connector-whoop-ink: var(--connector-whoop-ink);
--color-connector-whoop-tint: var(--connector-whoop-tint);
--color-connector-withings-ink: var(--connector-withings-ink);
--color-connector-withings-tint: var(--connector-withings-tint);
--color-connector-oura-ink: var(--connector-oura-ink);
--color-connector-oura-tint: var(--connector-oura-tint);
--color-connector-apple-ink: var(--connector-apple-ink);
--color-connector-apple-tint: var(--connector-apple-tint);
```

- [ ] **Step 6: Run the whole contrast guard**

```bash
npx vitest run tests/contrast-guard.test.ts
```

Expected: PASS, including ten newly-generated `connector-*-ink on its own
connector-*-tint clears 4.5:1` cases (five pairs × two themes) and the
"every token in every theme block is checked, aliased, or waived" case — which
will fail if a token was added to one theme block and not the other.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css tests/contrast-guard.test.ts
git commit -m "feat(tokens): give the five connector brands a light expression

Every connector avatar and Connect button was a dark-only value — Whoop's
brand is literally #ffffff — so all five broke on a light ground. Five
ink/tint pairs on the slice-4 inbox-kind pattern, 6.38:1 worst case.
The Connect action itself moves to --accent in a later commit: one
action, one token, rather than five bespoke solid/on-solid pairs."
```

---

## Phase 2 — the shell, with no class changes

### Task 2: Extract `ConnectorCard` and cover it with tests

**Files:**

- Create: `src/components/settings/connector-card.tsx`
- Create: `src/components/settings/connector-card.test.tsx`

**Interfaces:**

- Produces:
  ```typescript
  export type ConnectorTone =
    "strava" | "whoop" | "withings" | "oura" | "apple";

  export interface ConnectorCardProps {
    name: string; // "Strava"
    tone: ConnectorTone;
    glyph: React.ReactNode; // the avatar character, e.g. "↗"
    subtitle: React.ReactNode; // "Connected as Bart" | "Not connected"
    actions?: React.ReactNode; // Sync/Disconnect pair, CTA, or badge
    status?: { message: React.ReactNode; ok: boolean } | null;
    children?: React.ReactNode; // per-provider body below the header
  }
  export function ConnectorCard(props: ConnectorCardProps): React.JSX.Element;

  export const connectorPillClass: string; // Sync — secondary pill
  export const connectorGhostClass: string; // Disconnect — ghost pill
  export const connectorCtaClass: string; // Connect — the CTA
  export const connectorBadgeClass: string; // "Set STRAVA_CLIENT_ID"
  ```
- Consumed by: Tasks 3, 4 and 5.

**This task changes no class strings.** Every string below is copied verbatim
from the existing cards. Task 5 migrates them; keeping the two apart is the
whole point of D2.

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/connector-card.test.tsx`. The project has no
`@testing-library/react` — tests drive React directly with `createRoot` and
`act`, as `apple-health-card.a11y.test.tsx` does. Follow that.

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectorCard } from "./connector-card";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
  return container;
}

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

describe("ConnectorCard", () => {
  it("renders the provider name, subtitle and avatar glyph", async () => {
    const el = await render(
      <ConnectorCard
        name="Withings"
        tone="withings"
        glyph="⚖"
        subtitle="Weight, body composition, blood pressure"
      />
    );
    expect(el.textContent).toContain("Withings");
    expect(el.textContent).toContain("Weight, body composition");
    expect(el.textContent).toContain("⚖");
  });

  it("hides the avatar glyph from assistive tech", async () => {
    const el = await render(
      <ConnectorCard
        name="Oura"
        tone="oura"
        glyph="◍"
        subtitle="Staged sleep"
      />
    );
    // The glyph is decoration; the provider name carries the meaning.
    const hidden = el.querySelector("[aria-hidden]");
    expect(hidden?.textContent).toBe("◍");
  });

  it("renders no status paragraph when status is null", async () => {
    const el = await render(
      <ConnectorCard name="Whoop" tone="whoop" glyph="W" subtitle="HRV" />
    );
    expect(el.querySelector("[role='status']")).toBeNull();
  });

  it("renders the status message as a live region when given one", async () => {
    const el = await render(
      <ConnectorCard
        name="Whoop"
        tone="whoop"
        glyph="W"
        subtitle="HRV"
        status={{ message: "Synced 42 activities", ok: true }}
      />
    );
    const status = el.querySelector("[role='status']");
    expect(status?.textContent).toBe("Synced 42 activities");
  });

  it("renders actions and per-provider children in document order", async () => {
    const el = await render(
      <ConnectorCard
        name="Strava"
        tone="strava"
        glyph="↗"
        subtitle="Connected as Bart"
        actions={<button type="button">Sync</button>}
      >
        <p>Auto-describe new activities</p>
      </ConnectorCard>
    );
    expect(el.textContent).toContain("Sync");
    expect(el.textContent).toContain("Auto-describe new activities");
    const text = el.textContent ?? "";
    expect(text.indexOf("Sync")).toBeLessThan(
      text.indexOf("Auto-describe new activities")
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/components/settings/connector-card.test.tsx
```

Expected: FAIL — `Failed to resolve import "./connector-card"`.

- [ ] **Step 3: Write the component**

Create `src/components/settings/connector-card.tsx`. Every class string here is
the existing one, unchanged:

```tsx
import type { ReactNode } from "react";

/**
 * The chrome five Settings connector cards duplicated verbatim — wrapper,
 * header row, avatar chip, name, subtitle, an actions slot and the status
 * paragraph. whoop-card.tsx and withings-card.tsx were the same 100 lines
 * with different nouns; oura, strava and apple-health were that plus a body.
 *
 * Extracted in v0.106.0 (2b.4 slice 5 phase B) BEFORE the redesign touched
 * any class, so the migration edits this markup once instead of five times
 * and a mistake in the extraction shows up against unchanged markup.
 *
 * The four class constants below are the button shapes the same five cards
 * duplicated. They are exported as strings rather than components because
 * the call sites are variously <button>, <a> and form submits, and a
 * polymorphic component would cost more than it saves. Tailwind v4 compiles
 * any class that appears as a literal string in source, so these compile —
 * and the source-scanning guards in tests/type-scale-guard.test.ts see them
 * exactly as they see inline ones.
 */

export type ConnectorTone = "strava" | "whoop" | "withings" | "oura" | "apple";

/** Avatar chip colours, per brand. Migrated onto tokens in Task 5. */
const TONE_CHIP: Record<ConnectorTone, string> = {
  strava: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  whoop: "border-white/20 bg-white/10",
  withings: "border-teal-400/20 bg-teal-400/10 text-teal-300",
  oura: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  apple: "border-red-400/20 bg-red-400/10 text-red-300",
};

export const connectorPillClass =
  "rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-50";

export const connectorGhostClass =
  "rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50";

export const connectorCtaClass =
  "rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50";

export const connectorBadgeClass =
  "rounded bg-white/5 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-white/50";

export interface ConnectorCardProps {
  name: string;
  tone: ConnectorTone;
  glyph: ReactNode;
  subtitle: ReactNode;
  actions?: ReactNode;
  status?: { message: ReactNode; ok: boolean } | null;
  children?: ReactNode;
}

export function ConnectorCard({
  name,
  tone,
  glyph,
  subtitle,
  actions,
  status,
  children,
}: ConnectorCardProps) {
  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl border ${TONE_CHIP[tone]}`}
          >
            <span aria-hidden className="text-base">
              {glyph}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold">{name}</p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              {subtitle}
            </span>
          </div>
        </div>
        {actions}
      </div>

      {status && (
        <p
          role="status"
          className={`mt-3 text-xs ${
            status.ok ? "text-white/60" : "text-red-400"
          }`}
        >
          {status.message}
        </p>
      )}

      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/components/settings/connector-card.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the axe test**

Create `src/components/settings/connector-card.a11y.test.tsx`, following the
header of `apple-health-card.a11y.test.tsx` exactly (including the hand-rolled
matcher registration and the comment explaining why):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { ConnectorCard, connectorPillClass } from "./connector-card";

// See src/components/ui/collapsible.test.tsx for why matchers are registered
// by hand rather than via vitest-axe/extend-expect.
expect.extend(matchers);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

describe("ConnectorCard accessibility", () => {
  it("has no axe violations in its connected state", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ConnectorCard
          name="Strava"
          tone="strava"
          glyph="↗"
          subtitle="Connected as Bart"
          status={{ message: "Synced", ok: true }}
          actions={
            <button type="button" className={connectorPillClass}>
              Sync
            </button>
          }
        />
      );
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 6: Run it**

```bash
npx vitest run src/components/settings/connector-card.a11y.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/connector-card.tsx \
        src/components/settings/connector-card.test.tsx \
        src/components/settings/connector-card.a11y.test.tsx
git commit -m "refactor(settings): extract the shell five connector cards shared

whoop-card and withings-card were the same 100 lines with different
nouns; oura, strava and apple-health were that plus a body. No class
string changes here on purpose — the redesign edits this markup once
instead of five times, and a mistake in the extraction fails against
markup that has not moved."
```

### Task 3: Move Whoop, Withings and Oura onto the shell

**Files:**

- Modify: `src/components/settings/whoop-card.tsx`
- Modify: `src/components/settings/withings-card.tsx`
- Modify: `src/components/settings/oura-card.tsx`
- Modify: `tests/type-scale-guard.test.ts` — **repay Task 2's ceiling raise**
- Modify: `tests/dead-component-guard.test.ts` — remove the `KNOWN_ORPHANS` entry

**A debt this task inherits and must repay.** Task 2 created the shell before
anything consumed it, so for one commit the chrome exists in six places instead
of five, and both `OFFENDER_CEILINGS` had to rise — `arbitrary type sizes`
112 → 117, `ad-hoc white/black alpha utilities` 267 → 278. That raise was
accepted as transient on the explicit condition that **this task pays it back**,
because deleting three cards' duplicated chrome drops the real counts below the
original 112 / 267. Measure and re-pin both downward in this task's commit; do
not defer it to Task 12. `type-scale-guard.test.ts`'s own comment is the reason:
a ceiling with slack is free offenders for whoever comes next, and the ratchet
only signals if it stays tight.

`connector-card.tsx` also leaves `KNOWN_ORPHANS` here — this task gives it its
first real render site, and the dead-component guard's own "still genuinely
orphaned" assertion will fail until the entry is removed.

**Interfaces:**

- Consumes: `ConnectorCard`, `connectorPillClass`, `connectorGhostClass`,
  `connectorCtaClass`, `connectorBadgeClass` from Task 2.

Still no class changes. Each card keeps its own props, actions, error map and
state; only the chrome moves. `connectorCtaClass` carries no colour, so each
call site appends its own brand classes for now — Task 5 replaces those with
`bg-accent text-accent-foreground`.

**One exception, ruled before this task started: the shell owns the glyph's
type.** Whoop's monogram is `text-sm font-black tracking-tight`; the shell
renders every glyph at `text-base`, so Whoop's "W" gains 2px and loses its
black weight and tight tracking. That is deliberate — a one-character monogram
inside a 40px tinted chip does not need a third signal beyond size and the
brand ink Task 5 gives it, and carrying a `glyphClass` prop through the shell
to preserve a difference the redesign flattens anyway would be waste. Say so in
the commit message, the way Task 4 says it for Strava's `text-xl`.

- [ ] **Step 1: Write the failing test for Whoop's three action states**

Create `src/components/settings/whoop-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/app/settings/whoop-actions", () => ({
  whoopDisconnect: vi.fn(),
  whoopSyncNow: vi.fn(),
}));

import { WhoopCard } from "./whoop-card";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
  return container;
}

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

describe("WhoopCard", () => {
  it("offers Sync and Disconnect when connected", async () => {
    const el = await render(
      <WhoopCard
        configured
        connection={{
          athleteName: "Bart",
          status: "active",
          lastSyncAt: null,
          lastError: null,
        }}
      />
    );
    expect(el.textContent).toContain("Connected as Bart");
    expect(el.textContent).toContain("Sync");
    expect(el.textContent).toContain("Disconnect");
  });

  it("offers Connect when configured but not connected", async () => {
    const el = await render(<WhoopCard configured connection={null} />);
    const link = el.querySelector("a[href='/api/connections/whoop']");
    expect(link?.textContent).toBe("Connect");
  });

  it("names the missing env var when not configured", async () => {
    const el = await render(<WhoopCard configured={false} connection={null} />);
    expect(el.textContent).toContain("Set WHOOP_CLIENT_ID");
    expect(el.querySelector("a[href='/api/connections/whoop']")).toBeNull();
  });

  it("surfaces an OAuth error param as a live region", async () => {
    const el = await render(
      <WhoopCard configured connection={null} errorParam="denied" />
    );
    expect(el.querySelector("[role='status']")?.textContent).toBe(
      "You declined the Whoop authorization."
    );
  });
});
```

- [ ] **Step 2: Run it against the current, un-refactored card**

```bash
npx vitest run src/components/settings/whoop-card.test.tsx
```

Expected: **PASS**. This is a characterization test — it pins the behaviour
that must survive the refactor. If it fails now, the test is wrong; fix it
before touching the component.

- [ ] **Step 3: Rewrite `whoop-card.tsx` onto the shell**

Replace the whole `return (…)` block. Keep the imports, `Props`,
`ERROR_MESSAGES` and the two hooks exactly as they are:

```tsx
const status =
  errorParam || result || connection?.lastError
    ? {
        ok: result?.ok ?? false,
        message:
          result?.message ??
          (errorParam ? ERROR_MESSAGES[errorParam] : null) ??
          `Last error: ${connection?.lastError}`,
      }
    : null;

return (
  <ConnectorCard
    name="Whoop"
    tone="whoop"
    glyph="W"
    subtitle={
      connection
        ? `Connected as ${connection.athleteName}`
        : "Recovery, HRV, staged sleep"
    }
    status={status}
    actions={
      connection ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => setResult(await whoopSyncNow()))
            }
            className={connectorPillClass}
          >
            {pending ? "…" : "Sync"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => setResult(await whoopDisconnect()))
            }
            className={connectorGhostClass}
          >
            Disconnect
          </button>
        </div>
      ) : configured ? (
        <a
          href="/api/connections/whoop"
          className={`${connectorCtaClass} bg-white text-black hover:bg-white/80`}
        >
          Connect
        </a>
      ) : (
        <span className={connectorBadgeClass}>Set WHOOP_CLIENT_ID</span>
      )
    }
  />
);
```

Add the import:

```tsx
import {
  ConnectorCard,
  connectorPillClass,
  connectorGhostClass,
  connectorCtaClass,
  connectorBadgeClass,
} from "./connector-card";
```

Note the one behaviour change the shell forces and the test above already
encodes: the status paragraph's `ok` is now `result?.ok ?? false` rather than
`result?.ok` — previously `undefined` fell through to the error styling, which
is what `?? false` reproduces.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/components/settings/whoop-card.test.tsx
```

Expected: PASS, all 4, with no test edits. That is the refactor's proof.

- [ ] **Step 5: Do the same for Withings**

Identical shape. `tone="withings"`, `glyph="⚖"`, subtitle
`connection ? "Connected" : "Weight, body composition, blood pressure"`, CTA
`` `${connectorCtaClass} bg-teal-400 text-black hover:bg-teal-300` ``, badge
`Set WITHINGS_CLIENT_ID`, href `/api/connections/withings`, actions calling
`withingsSyncNow` / `withingsDisconnect`. Write
`src/components/settings/withings-card.test.tsx` mirroring Whoop's four cases,
but drop the `athleteName` assertion — Withings' props have no `athleteName`,
its connected subtitle is the literal `"Connected"`.

- [ ] **Step 6: Do the same for Oura**

Oura has no `configured` prop and no CTA link — it connects via a token form.
So its `actions` is `connection ? <Sync/Disconnect pair> : null`, and the form
and the help paragraph become `children`:

```tsx
    <ConnectorCard
      name="Oura"
      tone="oura"
      glyph="◍"
      subtitle={
        connection
          ? `Connected${connection.accountName ? ` · ${connection.accountName}` : ""}`
          : "Staged sleep, HRV, temperature"
      }
      status={
        message || connection?.lastError
          ? {
              ok: messageOk ?? false,
              message: message ?? `Last error: ${connection?.lastError}`,
            }
          : null
      }
      actions={connection ? (/* the Sync/Disconnect pair */) : null}
    >
      {!connection && (
        <form action={connectAction} className="mt-3 flex gap-2">
          <input
            name="token"
            type="password"
            placeholder="Personal access token"
            autoComplete="off"
            required
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
          <button
            type="submit"
            disabled={connecting}
            className={`${connectorCtaClass} shrink-0 bg-sky-400 text-black hover:bg-sky-300`}
          >
            {connecting ? "…" : "Connect"}
          </button>
        </form>
      )}
      {!connection && (
        <p className="mt-2 text-[10px] text-white/40">
          Create a token at cloud.ouraring.com → Personal Access Tokens. Stored
          encrypted (AES-256-GCM).
        </p>
      )}
    </ConnectorCard>
```

Write `src/components/settings/oura-card.test.tsx` covering: connected shows
Sync/Disconnect; disconnected shows the token form with a required password
input; disconnected shows the help text; a `lastError` renders as `role=status`.

- [ ] **Step 7: Confirm the class inventory has not moved**

The refactor must be class-neutral. Verify:

```bash
node -e '
const {readdirSync,readFileSync,statSync}=require("fs");const {join}=require("path");
const AT=/\btext-\[[^\]]*(?:px|rem|em)\]/g;
const AI=/\b(?:text|bg|border|fill|stroke|ring|divide)-(?:white|black)\/(?:\d+|\[[^\]]+\])/g;
function walk(d,o=[]){for(const e of readdirSync(d)){const f=join(d,e);if(statSync(f).isDirectory())walk(f,o);else if(/\.tsx?$/.test(f)&&!/\.test\.tsx?$/.test(f))o.push(f);}return o;}
let at=0,ai=0;for(const f of walk("src")){const t=readFileSync(f,"utf8");at+=(t.match(AT)||[]).length;ai+=(t.match(AI)||[]).length;}
console.log("arbitraryType:",at,"adhocInk:",ai);'
```

Expected: **both numbers fell** from the 112 / 267 they start at, because three
cards' duplicated chrome collapsed into one copy. Nothing was tokenised, so the
drop is pure deduplication — roughly 9 arbitrary sizes and 16 ink occurrences,
but the exact figure depends on how the shell's `TONE_CHIP` entries land, so
**record what you actually measure rather than matching a predicted number**.
What must be true: both counts went _down_, and no file gained an offender.

- [ ] **Step 8: Five green checks and commit**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/components/settings/
git commit -m "refactor(settings): put Whoop, Withings and Oura on the shell

Characterization tests written first and unchanged across the move —
17 cases over three cards that previously had none. Still no class
changes; the duplicated chrome simply stopped being duplicated, which
takes 8 arbitrary sizes and 21 ad-hoc ink occurrences out of the count
without migrating anything."
```

### Task 4: Move Strava and Apple Health onto the shell

**Files:**

- Modify: `src/components/settings/strava-card.tsx`
- Modify: `src/components/settings/apple-health-card.tsx`
- Modify: `src/components/settings/apple-health-card.test.tsx` (only if the
  existing cases reference removed markup — read them first)

Both cards keep substantial bodies: Strava's write-scope upgrade banner,
auto-describe toggle, sync-options block and example-data `<pre>`;
Apple Health's upload form, result `<pre>` and instructions. All of that
becomes `children`. **Do not migrate any class in this task.**

- [ ] **Step 1: Read the existing Apple Health tests before touching it**

```bash
npx vitest run src/components/settings/apple-health-card.test.tsx \
               src/components/settings/apple-health-card.a11y.test.tsx
```

Expected: PASS. These already cover the accessible-name fix v0.105.0 shipped
(`bda1ea7`). They must still pass after the move, unedited. If a case asserts
on markup the shell reorganises, that is a signal the shell is wrong, not the
test — fix the shell.

- [ ] **Step 2: Write characterization tests for Strava's header states**

Create `src/components/settings/strava-card.test.tsx` covering the same four
states as Whoop's (connected / configured-not-connected / not-configured /
error param), plus the two Strava-only branches:

`StravaCard`'s `Props` (declared at the top of `strava-card.tsx`) require
`autoDescribe: boolean` and `descriptionFields: DescriptionFields` on every
render, not just the toggle cases. `DescriptionFields` is
`Partial<Record<DescriptionField, boolean>>` from
`src/lib/strava-description-fields.ts`, so `{}` is valid. A local helper keeps
the six cases readable:

```tsx
const connected = (writeEnabled: boolean) => ({
  athleteName: "Bart",
  status: "active",
  lastSyncAt: null,
  lastError: null,
  writeEnabled,
});

it("prompts to reconnect when the connection cannot write", async () => {
  const el = await render(
    <StravaCard
      configured
      connection={connected(false)}
      autoDescribe={false}
      descriptionFields={{}}
    />
  );
  expect(el.textContent).toContain(
    "Upgrade Strava connection for AI descriptions"
  );
  expect(el.textContent).toContain("Reconnect");
});

it("offers the auto-describe toggle only when writes are enabled", async () => {
  const el = await render(
    <StravaCard
      configured
      connection={connected(true)}
      autoDescribe={false}
      descriptionFields={{}}
    />
  );
  expect(el.textContent).toContain("Auto-describe new activities on Strava");
  expect(el.querySelector("input[type='checkbox']")).not.toBeNull();
});
```

The four header-state cases take the same two extra props. Mock
`@/app/settings/strava-actions` the way the Whoop test mocks its own actions
module, and include `setStravaDescriptionFields` and `setStravaAutoDescribe` in
the mock — read the card's imports for the exact export names.

- [ ] **Step 3: Run them against the un-refactored card**

```bash
npx vitest run src/components/settings/strava-card.test.tsx
```

Expected: PASS. Characterization, same as Task 3 Step 2.

- [ ] **Step 4: Move Strava onto the shell**

`name="Strava"`, `tone="strava"`, `glyph="↗"`, subtitle
``connection ? `Connected as ${connection.athleteName}` : "Not connected"``,
CTA `` `${connectorCtaClass} bg-orange-500 text-black hover:bg-orange-400` ``,
badge `Set STRAVA_CLIENT_ID`. Everything from the write-scope banner down
becomes `children`, verbatim.

One detail: Strava's avatar glyph is `text-xl` where the shell hardcodes
`text-base`. Leave the shell at `text-base` and accept the 4px reduction on
that one glyph — Task 5 restates all five chips at a single size anyway, and
carrying a per-tone glyph-size prop through the shell to preserve a difference
Task 5 removes is waste. Note it in the commit.

- [ ] **Step 5: Move Apple Health onto the shell**

`name="Apple Health"`, `tone="apple"`, `glyph="♥"`, subtitle
`connected ? "Push via Health Auto Export" : "Sleep, HRV, BP, body comp"`,
badge `Set APP_BASE_URL`. The upload form,
the result `<pre>` and the instructions become `children`. **The file input's
accessible name must survive** — it is the critical fix v0.105.0 shipped, and
`apple-health-card.a11y.test.tsx` is what proves it.

- [ ] **Step 6: Run every settings test**

```bash
npx vitest run src/components/settings/
```

Expected: PASS, including both pre-existing Apple Health files unedited.

- [ ] **Step 7: Confirm the class inventory again**

Re-run the counter from Task 3 Step 7. Expected: both numbers fell again, for
the same reason — two more copies of the chrome collapsed. Still nothing
tokenised. Record the measured pair; Task 12 uses the total drop to explain how
much of the ceiling move came from extraction rather than migration.

- [ ] **Step 8: Five green checks and commit**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/components/settings/
git commit -m "refactor(settings): put Strava and Apple Health on the shell

Their per-provider bodies stay verbatim as children. Strava's avatar
glyph drops from text-xl to the shell's text-base — the redesign
restates all five chips at one size in the next commit, so carrying a
prop through the shell to preserve a difference about to be deleted
would be waste. Apple Health's file-input accessible name is unchanged
and its a11y test passes unedited."
```

---

## Phase 3 — the migration

Tasks 5–10 apply the class mapping table. Each ends with the same verification
shape, so it is stated once here and referenced by each task:

**The per-task check.** After editing, no file the task touched may match
either guard pattern:

```bash
grep -nE 'text-\[[^]]*(px|rem|em)\]|\b(text|bg|border|fill|stroke|ring|divide)-(white|black)/(([0-9]+)|\[[^]]+\])|\btext-(xs|sm|base|lg|xl|2xl|3xl)\b|\b(text|bg)-white\b' <the files this task touched>
```

Expected: no output. Then `npx vitest run` and the five green checks.

### Task 5: Migrate the connector shell

**Files:**

- Modify: `src/components/settings/connector-card.tsx` — the whole migration
- Modify: `src/components/settings/{strava,whoop,withings,oura,apple-health}-card.tsx`
  — **Step 4 only**, deleting the appended brand-CTA fragments. Nothing else in
  those five files changes in this task; Tasks 6–8 own the rest.

This is the task D2 exists for: one file carries the migration, five cards get
fixed by it.

- [ ] **Step 1: Replace the tone chips with the Task 1 tokens**

```tsx
/** Avatar chip colours, per brand — ink on its own tint, both themes. */
const TONE_CHIP: Record<ConnectorTone, string> = {
  strava: "bg-connector-strava-tint text-connector-strava-ink",
  whoop: "bg-connector-whoop-tint text-connector-whoop-ink",
  withings: "bg-connector-withings-tint text-connector-withings-ink",
  oura: "bg-connector-oura-tint text-connector-oura-ink",
  apple: "bg-connector-apple-tint text-connector-apple-ink",
};
```

The chip loses its border: the tint _is_ the chip now, and a `border-hairline`
ring around a filled tint reads as a second box. Drop `border` from the
wrapper's class list along with the per-tone border colours.

- [ ] **Step 2: Replace the four button classes**

```tsx
export const connectorPillClass =
  "rounded-full border border-hairline bg-surface-overlay px-3 py-1.5 text-label font-bold uppercase tracking-wider transition-colors hover:bg-surface-selected disabled:opacity-50";

export const connectorGhostClass =
  "rounded-full border border-hairline px-3 py-1.5 text-label font-bold uppercase tracking-wider text-ink-muted transition-colors hover:bg-destructive-tint hover:text-destructive-ink disabled:opacity-50";

export const connectorCtaClass =
  "rounded-full bg-accent px-4 py-2 text-label font-bold uppercase tracking-wider text-accent-foreground transition-colors hover:opacity-90 disabled:opacity-50";

export const connectorBadgeClass =
  "rounded bg-surface-overlay px-2 py-1 text-label font-bold uppercase tracking-widest text-ink-muted";
```

`connectorCtaClass` now carries its own colour — that is D1. The `text-[8px]`
badge lifts to 12px, a 50% increase; it keeps its quietness from
`tracking-widest`, `uppercase` and `ink-muted`, per the spec's micro-label
rule.

- [ ] **Step 3: Migrate the shell's own type and ink**

- `text-base` on the glyph → `text-body`
- `text-sm font-bold` on the name → `text-caption font-bold`
- the subtitle's `text-[10px] … text-white/50` → `text-label … text-ink-muted`
- the status paragraph's `text-xs` → `text-label`, and its ternary
  `"text-white/60" : "text-red-400"` → `"text-ink-secondary" : "text-destructive-ink"`

- [ ] **Step 4: Strip the brand classes the five call sites still append**

Each card appends brand colour to `connectorCtaClass` — `bg-white text-black
hover:bg-white/80`, `bg-teal-400 text-black hover:bg-teal-300`, `bg-sky-400
text-black hover:bg-sky-300`, `bg-orange-500 text-black hover:bg-orange-400`,
and Apple Health's equivalent. Delete those appended fragments in all five
files so the constant's own `bg-accent text-accent-foreground` applies. Strava
has a **second** CTA — the write-scope `Reconnect` link — with the same
appended fragment. Delete that one too.

- [ ] **Step 5: Run the settings tests**

```bash
npx vitest run src/components/settings/
```

Expected: PASS, unedited. Every test in Tasks 2–4 asserts on text and roles,
not classes, which is why the migration does not touch them.

- [ ] **Step 6: The per-task check, five green checks, commit**

```bash
grep -nE 'text-\[[^]]*(px|rem|em)\]|\b(text|bg|border|fill|stroke|ring|divide)-(white|black)/(([0-9]+)|\[[^]]+\])|\btext-(xs|sm|base|lg|xl)\b|\b(text|bg)-white\b' \
  src/components/settings/connector-card.tsx
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/components/settings/
git commit -m "feat(settings): migrate the connector shell to the token scale

One file, five cards. The 8px 'Set X_CLIENT_ID' badge lifts to the 12px
floor and keeps its quietness from tracking and ink. All five Connect
CTAs become the accent button: one action, one token, and the brand
stays in the avatar chip where it identifies rather than instructs."
```

### Task 6: Migrate the rest of Integrations

**Files:**

- Modify: `src/components/settings/strava-card.tsx` (10 arb, 23 ink, 8 dflt)
- Modify: `src/components/settings/apple-health-card.tsx` (12/22/5)
- Modify: `src/components/settings/intervals-card.tsx` (1/2/7)
- Modify: `src/components/settings/oura-card.tsx` — **everything still
  matching**, not only the token form: the help paragraph below it
  (`text-[10px] text-white/40`) sits outside the form and is in scope too. The
  per-task check grep is the contract; the file list is a hint.

Apply the mapping table to every remaining match. Specific decisions:

- **The `<pre>` blocks** (`strava-card.tsx:223`, `apple-health-card.tsx:122`):
  `border border-white/5 bg-black/30` → `border border-hairline
bg-surface-base`, `text-xs text-white/80` → `text-label text-ink-secondary`.
- **Text inputs** (`oura-card.tsx:84`, `intervals-card.tsx:129`):
  `border-white/10 bg-white/5 … text-sm text-white` → `border-hairline
bg-surface-overlay … text-caption text-ink-primary`.
- **`text-orange-400`** on `apple-health-card.tsx:125` is warning text, not
  brand chrome → `text-kind-warning-ink`. **`text-amber-300`** on line 153 the
  same.
- **`strava-card.tsx:220`'s `<span className="text-white/40">(example data)</span>`**
  is a parenthetical inside a label already at `ink-muted`. Rather than paint
  it a second, quieter ink that the floor forbids, **delete the span and keep
  the text** — it inherits the label's ink. This is the slice's one editorial
  cut; record it in the commit.

- [ ] **Step 1: Apply the mapping to `strava-card.tsx`**
- [ ] **Step 2: Apply the mapping to `apple-health-card.tsx`**
- [ ] **Step 3: Apply the mapping to `intervals-card.tsx`**
- [ ] **Step 4: Apply the mapping to `oura-card.tsx`'s form**
- [ ] **Step 5: The per-task check**

```bash
grep -nE 'text-\[[^]]*(px|rem|em)\]|\b(text|bg|border|fill|stroke|ring|divide)-(white|black)/(([0-9]+)|\[[^]]+\])|\btext-(xs|sm|base|lg|xl)\b|\b(text|bg)-white\b' \
  src/components/settings/{strava,apple-health,intervals,oura,whoop,withings}-card.tsx
```

Expected: no output.

- [ ] **Step 6: Five green checks and commit**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/components/settings/
git commit -m "feat(settings): migrate the Integrations section

One editorial cut: strava-card's '(example data)' parenthetical was
painted text-white/40 inside a label already at the ink floor. Below the
floor there is no quieter ink to give it, so the span is deleted and the
text inherits the label's — restated rather than shrunk, the rule slice
4 set when it deleted a per-message timestamp."
```

### Task 7: Migrate AI & Coach and Advanced / API

**Files:**

- Modify: `src/components/settings/llm-usage-card.tsx` (0/5/3)
- Modify: `src/components/settings/llm-settings-card.tsx` (0/0/4)
- Modify: `src/components/settings/coach-card.tsx` (0/0/6)
- Modify: `src/components/settings/api-tokens-card.tsx` (0/0/8)
- Modify: `src/components/settings/webhooks-card.tsx` (0/2/11)
- Modify: `src/components/settings/sessions-card.tsx` (0/0/5)

Six files, 44 edits, all straight mapping-table application. Four of these have
zero guard offenders and only default-scale utilities — they are the cheapest
files in the slice, with one trap: `api-tokens-card.tsx:102` carries a bare
`bg-white` that the scope table's `0/0/8` does not count, because no guard
pattern matches it. It goes to `bg-surface-raised` like any other. Read the
line before changing it — if that white is a deliberate high-contrast ground
for a freshly-created token, `bg-surface-raised` is still the right token for
"the raised ground", and it carries both themes.

`webhooks-card.tsx:165`'s `<code className="… bg-black/40 … text-xs
text-white/80">` → `bg-surface-base … text-label text-ink-secondary`.

- [ ] **Step 1: Apply the mapping to the three AI & Coach cards**
- [ ] **Step 2: Apply the mapping to the three Advanced / API cards**
- [ ] **Step 3: Run the webhooks test**

```bash
npx vitest run src/components/settings/webhooks-card.test.tsx \
               src/app/settings/__tests__/sessions.test.ts
```

Expected: PASS, unedited.

- [ ] **Step 4: The per-task check, five green checks, commit**

```bash
grep -nE 'text-\[[^]]*(px|rem|em)\]|\b(text|bg|border|fill|stroke|ring|divide)-(white|black)/(([0-9]+)|\[[^]]+\])|\btext-(xs|sm|base|lg|xl)\b|\b(text|bg)-white\b' \
  src/components/settings/{llm-usage,llm-settings,coach,api-tokens,webhooks,sessions}-card.tsx
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/components/settings/
git commit -m "feat(settings): migrate AI & Coach and Advanced / API"
```

### Task 8: Migrate the App section

**Files:**

- Modify: `src/components/settings/notifications-card.tsx` (1/9/7)
- Modify: `src/components/settings/body-prefs-card.tsx` (3/13/8)
- Modify: `src/components/settings/ride-debrief-toggles.tsx` (2/4/3)
- Modify: `src/components/settings/ride-debrief-card.tsx` (0/0/0 — check and
  skip if genuinely clean)

`body-prefs-card.tsx` carries five copies of the same input class
(`w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm
text-white`). Hoist it to a file-local `const inputClass` before migrating, so
the five become one — the same argument as D2, at a smaller scale.

- [ ] **Step 1: Hoist `body-prefs-card.tsx`'s repeated input class**

```tsx
const inputClass =
  "w-full rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary";
```

- [ ] **Step 2: Apply the mapping to all four files**
- [ ] **Step 3: The per-task check, five green checks, commit**

```bash
grep -nE 'text-\[[^]]*(px|rem|em)\]|\b(text|bg|border|fill|stroke|ring|divide)-(white|black)/(([0-9]+)|\[[^]]+\])|\btext-(xs|sm|base|lg|xl)\b|\b(text|bg)-white\b' \
  src/components/settings/{notifications-card,body-prefs-card,ride-debrief-toggles,ride-debrief-card}.tsx
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/components/settings/
git commit -m "feat(settings): migrate the App section

body-prefs-card had the same input class written out five times; hoisted
to one const before migrating so the token swap happens once."
```

### Task 9: Migrate the page shell and the Data section

**Files:**

- Modify: `src/app/settings/page.tsx` (15/29/7 — the largest single file)

The five `<Collapsible>` triggers share three class strings between them
(lines 264/382/428/479/525, 270/388/434/488/531 and the wrappers). Hoist those
to file-local consts before migrating, the same as Task 8.

Specific decisions:

- **`page.tsx:226`** `text-[22px] font-bold` → `text-heading font-bold`
  (22 → 24px).
- **`page.tsx:242`** `text-[13.5px] font-bold` → `text-caption font-bold`.
- **`page.tsx:245`** `text-[10.5px] text-white/45` — the athlete's email under
  their name → `text-label text-ink-muted` (10.5 → 12px).
- **`page.tsx:264` and its four siblings** `text-[10px] font-medium
text-white/35` → `text-label font-medium text-ink-muted`. `/35` is well below
  the floor; the step down in emphasis from the section label beside it comes
  from `font-medium` against that label's `font-bold`.
- **`page.tsx:575`** the footer, which renders
  `Recover · Self-hosted · AGPL-3.0`: `text-[10px] … tracking-[0.2em]
text-white/25` → `text-label … tracking-[0.2em] text-ink-muted`. `/25` is the
  quietest ink in the file and nearly four times below the floor; it keeps its
  recessiveness from `tracking-[0.2em]` and `uppercase`.
- **`page.tsx:253`** `text-emerald-400` on the sign-out link → `text-accent`,
  which is the token for exactly this and carries both themes.

- [ ] **Step 1: Read `page.tsx:220-290` and `520-581` in full**

The section triggers and the Data section are the parts this task restructures;
read them before editing rather than pattern-matching from the grep output.

- [ ] **Step 2: Hoist the three repeated trigger class strings to consts**
- [ ] **Step 3: Apply the mapping across the file**
- [ ] **Step 4: The per-task check**

```bash
grep -nE 'text-\[[^]]*(px|rem|em)\]|\b(text|bg|border|fill|stroke|ring|divide)-(white|black)/(([0-9]+)|\[[^]]+\])|\btext-(xs|sm|base|lg|xl)\b|\b(text|bg)-white\b' \
  src/app/settings/page.tsx
```

Expected: no output.

- [ ] **Step 5: Five green checks and commit**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/app/settings/page.tsx
git commit -m "feat(settings): migrate the page shell and the Data section

The five section triggers shared three class strings written out five
times each; hoisted before migrating. The athlete's email lifts from
10.5px to the floor, and the page title from 22px to the scale's 24."
```

### Task 10: Retire `button.tsx`'s arbitrary size

**Files:**

- Modify: `src/components/ui/button.tsx:26`

This is D3. `tests/type-scale-guard.test.ts`'s own comment deferred this one to
"whichever slice migrates that shared component next", and Settings is the
first migrated surface that imports Button (6 of its files do).

- [ ] **Step 1: Make the change**

```tsx
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-label in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
```

12.8px → 12px. Leave `xs`'s `text-xs` and the base `text-sm` alone — they are
Tailwind defaults, not guard offenders, and changing them repaints `admin`,
`import` and `login`, which slices 7 and 8 own.

- [ ] **Step 2: Find every `size="sm"` Button in the app and look at it**

```bash
grep -rn 'size="sm"' src --include=*.tsx | grep -v test
```

The change is 0.8px on every one of them. Confirm none sit in a fixed-width
container that a hair more text would overflow.

- [ ] **Step 3: Five green checks and commit**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
git add src/components/ui/button.tsx
git commit -m "feat(ui): retire button sm's arbitrary text size

text-[0.8rem] to text-label, 12.8px to 12px. type-scale-guard's own
comment left this for 'whichever slice migrates that shared component
next' — Settings is the first migrated surface that imports Button.
The other four primitives Settings imports carry only Tailwind default
scale, which is not a guard offender and whose call sites live on
admin, import and login: slices 7 and 8, not this one."
```

---

## Phase 4 — proof

### Task 11: Drive confirmed axe to zero

**Files:** whatever the audit names.

The baseline is 86 confirmed nodes, all `color-contrast`, all light-mode. This
task is where the leading-height risk from the scope section either shows up or
does not.

- [ ] **Step 1: Build from source and point it at the soak database**

Per `docs/RELEASING.md` — the RC image cannot serve this measurement, because
`?state=` is refused when `NODE_ENV === "production"` and the image predates
v0.105.0's fixes.

```bash
set -a; . ./.env; set +a
npm run build
DATABASE_URL="postgres://recover:recover@127.0.0.1:5435/recover" \
  DATABASE_DRIVER=pg npx next start -p 3100
```

- [ ] **Step 2: Re-seed onto the owner**

`verify-surfaces` signs in as the owner; seeding the demo user instead is what
made every capture before v0.105.0 a picture of an empty account.

```bash
export DATABASE_URL="postgres://recover:recover@127.0.0.1:5435/recover" DATABASE_DRIVER=pg
SEED_DEMO=1 DEMO_EMAIL="$OWNER_EMAIL" npm run db:seed-demo
```

- [ ] **Step 3: Capture all four Settings surfaces**

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- settings 2>&1 | tail -40
```

- [ ] **Step 4: Extract the per-surface numbers**

```bash
python3 - <<'PY'
import json
d = json.load(open(".screenshots/settings/axe-report.json"))
entries = d if isinstance(d, list) else d.get("entries", d.get("results", []))
tot = {}
for e in entries:
    s = e.get("surface")
    c = e.get("confirmedNodes", e.get("confirmed", 0))
    c = c if isinstance(c, int) else len(c or [])
    tot[s] = tot.get(s, 0) + c
for s, c in sorted(tot.items(), key=lambda kv: -kv[1]):
    print(f"{s:28} {c}")
print("TOTAL", sum(tot.values()))
PY
```

Expected: **0** for `settings`, `settings-expanded`, `settings-connect-errors`
and `settings-token-created`. Anything non-zero is a real remaining violation —
read the node it names, fix it, re-run. Do not accept a number above zero on
the grounds that light mode is unreachable; the whole slice exists to make it
zero before it becomes reachable.

- [ ] **Step 5: Look at the screenshots**

This is the step the leading change makes non-optional. Open:

```
.screenshots/settings/settings-expanded-dark-desktop.png
.screenshots/settings/settings-expanded-dark-phone.png
.screenshots/settings/settings-connect-errors-dark-desktop.png
```

Check specifically: the five connector cards' rows still fit on phone width
with the 12px badge and the accent CTA; no card's header wraps awkwardly where
the subtitle grew from 10px to 12px; the five section triggers still read as a
hierarchy; the `<pre>` blocks on Strava and Apple Health still scroll rather
than overflow. **Content that no longer fits gets cut, stacked or restated —
never shrunk below the floor.** Record any such cut in the commit message.

- [ ] **Step 6: Commit whatever the audit forced**

```bash
git add -A
git commit -m "fix(settings): drive confirmed axe to zero across all four surfaces

<name the nodes that were left and what each needed>"
```

### Task 12: Re-pin the ratchet and ship

**Files:**

- Modify: `tests/type-scale-guard.test.ts` — both `OFFENDER_CEILINGS` entries
- Modify: `docs/ROADMAP.md`, `CHANGELOG.md`, `package.json`
- Modify: `docs/plans/2026-08-17-v0106-slice5-settings-redesign.md` (this file)

- [ ] **Step 1: Read the real counts out of the failing suite**

```bash
npx vitest run tests/type-scale-guard.test.ts 2>&1 | grep -A3 "Re-pin OFFENDER_CEILINGS"
```

Both ceilings will have failed the `RATCHET_SLACK` check — that is the ratchet
working. Projected: `arbitrary type sizes` 112 → **52**,
`ad-hoc white/black alpha utilities` 267 → **127**. Use the numbers the suite
prints, not these.

- [ ] **Step 2: Re-pin both, with the reason**

Follow the existing comment style — each ceiling carries a dated note saying
what moved it and how it was verified. State the split: how much came from
tokenising and how much from the Tasks 2–4 extraction, which removed
occurrences without migrating them.

- [ ] **Step 3: Confirm the suite is green**

```bash
npx vitest run tests/type-scale-guard.test.ts tests/contrast-guard.test.ts
```

- [ ] **Step 4: Record the result in this plan**

Add a "Result" section: the confirmed-node numbers before and after, the two
ceiling moves, the editorial cuts taken, and anything Task 11's screenshots
forced. **Do not carry these in your head** — phase A's plan records that the
roadmap has been wrong twice from summarising counts from memory.

- [ ] **Step 5: Tick the roadmap**

`docs/ROADMAP.md`'s 2b.4 item — mark slice 5 complete, update the header line
(currently "SLICES 0-4 OF 10 SHIPPED, PLUS SLICE 5's PHASE A"), and correct
"Five surface slices remain" to four (Activity · Admin+Import · pre-auth ·
sweep). The item stays open until slice 9.

- [ ] **Step 6: Five green checks, CHANGELOG, version, ship**

```bash
npm run lint && npm run typecheck && npm run build && npm run format:check
npx vitest run
```

Then follow `docs/RELEASING.md`'s RC → soak → promote. Note the two hazards
v0.105.1 and v0.105.2 fixed: the final tag must not undo the promotion, and
tagging an old commit resurrects the old trigger.

---

## Carried forward

- **Today's two light-only confirmed nodes** —
  `<strong class="font-bold text-white">Readiness 71 (amber).</strong>`, raw
  `text-white` on a light surface, only present when there is a readiness
  figure. Belongs to the slice 9 sweep; recorded in
  `docs/axe-baseline-2026-08-11-seeded.md` so the sweep need not rediscover it.
- **`card.tsx`, `badge.tsx`, `input.tsx`, `label.tsx`** still carry Tailwind
  default-scale utilities. Not guard offenders; their call sites are on admin,
  import and login. Slices 7 and 8.
- **`src/components/ui/inline-markdown.tsx:31`'s `text-[0.95em]`** — a relative
  em whose job is staying proportional to four different parent sizes. No
  fixed-step token replaces it. Left deliberately, as slice 4 left it.
- **`coach-thread` on a seeded database** — phase A's `DEMO_EMAIL=<owner>`
  runbook change in `docs/RELEASING.md` appears to have closed this. Task 11's
  full capture run will confirm it; if `coach-thread` still fails to resolve a
  thread, it is still open and moves to slice 6.

## Self-review

- **Spec coverage.** Type scale → Tasks 5–10. Ink ramp → Tasks 5–9. Surfaces →
  the mapping table, applied in Tasks 5–9. Tone colours with a light
  expression → Task 1 (connectors) and the mapping table's warning/error rows.
  Confirmed axe to zero → Task 11. Guard re-pin → Task 12. `.glass` is
  explicitly out of scope, with the reason.
- **Placeholders.** One step deliberately says "read the imports first" rather
  than carry code — Task 4 Step 2's mock of `strava-actions`, whose full export
  list this plan did not enumerate. Everything else carries its actual content:
  the Apple Health glyph (`♥`) and subtitle, the footer's real text
  (`Recover · Self-hosted · AGPL-3.0`), and `StravaCard`'s full required props
  were all read from source rather than left as checks.
- **Predicted numbers.** Tasks 3 and 4 originally pinned exact post-extraction
  offender counts. They were derived by hand, did not survive arithmetic, and
  are now stated as a direction plus "record what you measure" — a wrong pinned
  number costs the executor more than no number.
- **Type consistency.** `ConnectorCardProps`, `ConnectorTone`,
  `connectorPillClass`, `connectorGhostClass`, `connectorCtaClass` and
  `connectorBadgeClass` are declared in Task 2 and used under those exact names
  in Tasks 3, 4 and 5. `status` is `{ message, ok } | null` at every call site.
- **Numbers.** Every count in this plan came from a grep or a script run on
  2026-08-17, not from the predecessor document. The ten contrast ratios came
  from the project's own `contrastRatio()`.
