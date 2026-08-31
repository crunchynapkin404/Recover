# Design system

**Prescriptive: what to use.** Rewritten 2026-08-31 at the end of Phase 6.4,
the visual-polish strand — the rewrite Phase 2b.4's slice 9 promised and did
not ship, so this document spent thirteen releases opening with "Descriptive,
not prescriptive" and claiming the app had one theme.

Every rule here is enforced by a test. Where one is, the test is named; a rule
with no guard beside it is a convention, and says so.

---

## Themes

**Two, and both are real.** `:root` is light, `.dark` is dark, and
`theme-provider.tsx` defaults to `system`. `forcedTheme` was lifted in
v0.111.0.

Anything you add must work in both. `renderableThemes()` is the single source
of which themes the app can render, and `tests/contrast-guard.test.ts` reads
**every** `:root`/`.dark` block in `globals.css` — six of them — and requires
every declaration to be checked, aliased or waived **by name**.

**A token's name is what governs it**, so naming is not decoration:

| Suffix                                       | Means            | Floor                               |
| -------------------------------------------- | ---------------- | ----------------------------------- |
| `--*-ink`                                    | text colour      | 4.5:1 on every surface, both themes |
| `--surface-*`                                | an opaque ground | must be opaque                      |
| `--*-hairline`, `-divider`, `-grid`, `-axis` | non-text         | none                                |

Add a token claiming none of those and the guard fails telling you so. There
is no list to remember to update.

## Type

Seven steps. **Use the semantic names, never Tailwind's own size keys** —
`text-sm` and friends are a second scale, and two scales mean two answers to
"how big is small text".

| Token          | Size | Leading | Use for                                |
| -------------- | ---: | ------: | -------------------------------------- |
| `text-label`   | 12px |     1.5 | the floor. Nothing smaller exists.     |
| `text-caption` | 14px |     1.5 | secondary prose, card bodies           |
| `text-body`    | 16px |     1.5 | body text; `body` itself sits here     |
| `text-title`   | 20px |    1.35 | surface headings                       |
| `text-heading` | 24px |    1.25 | page `h1`                              |
| `text-figure`  | 30px |     1.1 | a number the athlete reads at a glance |
| `text-hero`    | 44px |     1.0 | the primary figure, one per surface    |

**The leading is part of the scale**, added in Phase 6.4. Before that every
step inherited Tailwind preflight's `html { line-height: 1.5 }`, which is right
for a paragraph and wrong for a 44px figure — two call sites had already
patched their own with `leading-none`. `leading-*` at a call site still wins.

**The scale is in `rem`, anchored to `html`.** Changing `body`'s font-size
does not scale it; that is why the 15px → 16px flip in Phase 6.4 moved every
surface by 1–6px rather than reflowing the app.

`--font-numeric` (Geist Mono) is for figures — scores, HR, power. Named
separately from `--font-mono` so call sites read as intent, not "code font".

Enforced by `tests/type-scale-guard.test.ts` (a 12px floor, no arbitrary
sizes) and `tests/motion-scale-guard.test.ts` (no stock Tailwind sizes, every
step has a leading). **One arbitrary size exists**, recorded by name in
`RELATIVE_TYPE_INVENTORY`: `inline-markdown.tsx`'s `text-[0.95em]`, an optical
correction for Geist Mono setting larger than Geist Sans. A second one fails
the build.

## Spacing

**Tailwind's default 0.25rem base, deliberately not redeclared.** Seven
discrete `--spacing-N` keys used to sit in `@theme` restating exactly what that
base computes; they were deleted in Phase 6.4 because they claimed a
seven-step scale the app has never run.

It runs an **eleven-step 2px grid**: half-steps (`py-1.5`, `gap-1.5`,
`px-3.5`) are legitimate, and there are ~210 of them.

**Do not lower the base** to make half-steps look integral — `--spacing`
multiplies every spacing utility, so halving it halves every padding in the
app. Asserted.

## Motion

Six durations, four easings. **Never write a literal.**

| Token                            |  Value | Use for                                |
| -------------------------------- | -----: | -------------------------------------- |
| `--transition-duration-feedback` |  120ms | colour and opacity under the finger    |
| `--transition-duration-motion`   |  200ms | small transforms, pops, chips          |
| `--transition-duration-panel`    |  320ms | sheets, panel heights, entrances       |
| `--transition-duration-reveal`   | 1200ms | one-shot data draws: rings, sparklines |
| `--transition-duration-loop`     |     3s | ambient breathe / pulse                |
| `--transition-duration-drift`    |     8s | the shimmer rotation                   |

| Token             | Curve                               |
| ----------------- | ----------------------------------- |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)`      |
| `--ease-settle`   | `cubic-bezier(0.21, 1.02, 0.49, 1)` |
| `--ease-draw`     | `cubic-bezier(0.65, 0, 0.35, 1)`    |
| `--ease-spring`   | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

**Two traps, both learned the hard way and both asserted:**

- **The namespace is `--transition-duration-*`, not `--duration-*`.** Tailwind
  builds the `duration-<name>` utility from the former only; the latter is a
  plain custom property that produces no utility, so the class is inert while
  looking correct. The guard compiles `globals.css` and checks the rule is
  emitted, because a token's existence says nothing about a utility's.
- **Never take a name Tailwind already defines.** `--ease-in`, `--ease-out`,
  `--ease-in-out` and `--ease-linear` are its own keys: declaring one repoints
  every existing call site rather than adding a token. Hence `--ease-settle`.

**`transition-all` is banned.** List the properties that actually change.
Tailwind v4 uses standalone `translate` and `scale` properties, so
`transition-transform` does not cover them.

**Reduced motion** collapses durations to 1ms rather than `none`: `none`
_cancels_, so an animation never reaches its final frame and `transitionend`
never fires.

Enforced by `tests/motion-scale-guard.test.ts`, all three counted families at
zero.

## Radius

`--radius: 1rem`, with six derived steps `sm` → `4xl`. Use the steps.

## Primitives — `src/components/ui/`

Fifteen. The ones that carry a rule rather than a shape:

| Primitive                                   | Owns                               |
| ------------------------------------------- | ---------------------------------- |
| `pending-button`                            | the pending vocabulary — see below |
| `loading-screen`                            | the loading vocabulary — see below |
| `skeleton`                                  | decorative, always `aria-hidden`   |
| `confidence-chip`, `unavailable`            | the uncertainty vocabulary         |
| `button`, `badge`, `card`, `input`, `label` | shape, on the scales above         |

## The three vocabularies

Each exists so a state is expressed one way rather than N.

**Pending — work in flight.** `<PendingButton>` renders a plain `<button>` and
passes `className` through, because only 4 of the 26 components running a
transition use the `Button` primitive. `<Button pending>` shares the same
`pendingSemantics`. While pending a control is `disabled`, carries
`aria-busy`, and says so in its label; a string label gets a free ellipsis and
richer children must supply `pendingLabel`, so silence is unreachable by
omission.

**Not every `disabled={pending}` is this.** A Cancel beside a saving Save is
disabled _because_ work is in flight but is not doing the work — it stays a
plain button. `standard-week.tsx` is recorded in `NO_WORKING_BUTTON` for
exactly that reason.

**Loading — a route that waits.** Every `loading.tsx` wraps its skeletons in
`<LoadingScreen>`, which renders `role="status"` + `aria-live="polite"` and a
visually-hidden label. **`src/app/loading.tsx` passes no label**: it is the
root segment's boundary and stands in for every route, so naming a surface
there announces the wrong one.

Ten of the twelve routes have one. The two without are `/login` (a client
component, nothing to wait for) and `/wellness` (a redirect that never paints).

**Uncertainty — a number's confidence.** A number's owner returns
`Figure<T>`: `{ available: true, value, confidence, why? }`, rendered by
`<ConfidenceChip>` below `"high"`; or `{ available: false, ... }` in one of
three kinds — `calibrating`, `missing_input`, `not_supported` — rendered by
`<Unavailable>`. `src/lib/uncertainty.ts`, guarded by
`tests/uncertainty-dialects-guard.test.ts`.

## The guards, and what each is for

Fourteen. The design-system ones:

| Guard                  | Holds                                               |
| ---------------------- | --------------------------------------------------- |
| `contrast-guard`       | every token in every theme block, by name           |
| `type-scale-guard`     | the 12px floor, no arbitrary sizes, no ad-hoc ink   |
| `motion-scale-guard`   | motion, spacing, stock type sizes, loading, pending |
| `glass-contrast-guard` | text over translucent surfaces                      |
| `theme-color-guard`    | the browser chrome colour per theme                 |
| `viewport-zoom-guard`  | pinch-zoom is never disabled                        |

**A guard you can trip by writing prose is a guard people work around.** Four
scans in `motion-scale-guard` strip comments before matching, each after being
tripped by documentation that merely _named_ what it hunts for.
`viewport-zoom-guard` still matches bare words and has not been fixed.

## Conventions with no guard

Say so honestly, so nobody mistakes them for enforced:

- **Typographic rhythm beyond the scale** — where a heading sits relative to
  its content is judged in review against captures.
- **Density per role** — card padding still ranges `p-3` … `p-8`. The scale
  permits it; nothing checks it.
- **Which scale step a given piece of text deserves.** The floor is enforced;
  the choice is editorial.
