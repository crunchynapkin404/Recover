# The adversarial pass the spec said was owed

Written 2026-08-31 against `main` at v0.125.0, closing the section
`docs/specs/2026-08-31-structured-cycling-workouts-design.md` ends on:
_"The adversarial pass is owed before slice 0 begins."_

Every finding below was **run or read, not reasoned about**. Scenarios that
produce wrong output were produced by executing the plan's own transcribed
code; every code claim carries a `file:line` that was opened.

---

## Why this was done by hand rather than by resuming `wf_75d66937-84b`

Two independent reasons, the second of which matters more.

**The clock.** The seven dead agents — `judge:fits-the-repo`,
`judge:survives-reality`, `judge:authoring-economics`, `attack:adaptation`,
`attack:authoring`, `attack:drift`, `attack:degradation` — each failed with
`You've hit your session limit · resets 2:50pm (UTC)`. This pass began at
**10:51 UTC**. A resume before 14:50 re-runs seven agents into the same wall.

**The target is stale, which the clock hides.** The Verify phase attacks the
_Design phase's_ output, not the spec file:

```js
// scripts/structured-cycling-workouts-design-wf_75d66937-84b.js:270
`THE DESIGN UNDER ATTACK:
SHAPE:\n${winning.shape}\nMATCHER:\n${winning.matcher}\n...`;
```

`winning` is the cached `result.winningDesign`, and that cache **predates both
manual fixes**. Its own `weakness` field reads:

> "I have made pinning impossible rather than merely unimplemented… My design
> cannot ever show that badge, because it has nothing to compare against."

So the cached design has **no pin at all**, where the spec now has a four-field
one; and it carries the banded coverage the spec now repudiates. Resuming would
spend seven agents re-deriving the two defects already fixed, and would never
look at the four-field pin or the continuous-coverage guard — the newest and
least-reviewed parts. **The resume is not merely early. It is aimed at the
wrong artifact.**

Re-running it after 14:50 is still worth doing for independent confirmation,
but it needs `winning` re-seeded from the current spec first, or its findings
will be about a design nobody is going to build.

---

## Findings

Ordered by what blocks work soonest. `HELD` means the lens was tried and the
design survived it.

### S1 — Slice 0 cannot pass its own proof step. `CONFIRMED`

**Lens: slice-0 integrity.** Task 1 Step 3 requires `types.ts` be written
"exactly as the spec's Design 2 section gives it, **including every doc
comment**". That mandates, verbatim:

```ts
/** Targets are ALWAYS % of FTP, never watts. 88 means 88% FTP. */
```

Task 5 Step 2 then runs, and expects `no absolute power`:

```bash
grep -rniE "\bwatt|\bftpWatts|targetLoadKg" src/lib/interval/ || echo "no absolute power"
```

Run against the file the plan mandates, it prints:

```
src/lib/interval/types.ts:1:/** Targets are ALWAYS % of FTP, never watts. 88 means 88% FTP. */
```

`\bwatt` matches inside "watts", case-insensitively. **The plan writes a
comment in Task 1 that fails its own guard in Task 5.** The step can never
print its expected output.

This is precisely the trap `docs/2026-08-31-visual-polish-handoff.md` names —
_"A guard you can trip by writing prose is a guard people work around. This
happened **four times** in one strand"_ — reproduced a fifth time, in a plan
written after the handoff that documents it.

**Fix:** strip comments before matching, as `motion-scale-guard.test.ts` does.

### S4 — Neither slice-0 guard is a guard. `CONFIRMED`

Both purity checks are one-shot bash lines inside a markdown document, run by
hand once. `type-scale-guard.test.ts` and `motion-scale-guard.test.ts` are
real test files that ratchet. Nothing enforces "pure module" or "no wattage"
on the day after slice 0 lands.

**Fix:** one `src/lib/interval/purity-guard.test.ts`, comment-stripped, in the
same slice that makes the claim.

### D1 — `renderDescription` mis-describes an over-under. `CONFIRMED`

**Lens: drift.** The spec makes the unrolled over-under its central authoring
idiom — it is the stated reason blocks are one level deep ("an over-under is
authored as an unrolled body inside one repeat, which every renderer already
handles"). Every renderer does not handle it.

Executing the plan's transcribed `renderDescription` on a 3× over-under
(6 × 2 min alternating 105%/90%, then 5 min recovery):

| Renderer            | Output                                                               |
| ------------------- | -------------------------------------------------------------------- |
| `renderIcu`         | `Main set 3x` / `- 2m 105%` `- 2m 90%` ×3 / `- 5m 55%` — **correct** |
| `renderDescription` | `3 × 2 min at 105% FTP, 15 min recovery` — **wrong**                 |

The real recovery is 5 min; it reports 15. It counts the two other 105% overs
and all three 90% unders — the work itself — as recovery, and describes a
17-minute block as a 2-minute interval.

The cause is `rest` being computed by object identity against the single
peak-power step:

```ts
const work = main.steps.reduce((a, b) => (b.hi > a.hi ? b : a), main.steps[0]);
const rest = main.steps.filter((s) => s !== work); // everything that is not the peak
```

**This is the exact defect Design 4 exists to prevent** — two representations
of one workout disagreeing — arriving in the renderer whose docstring says the
sentence and the structure "cannot disagree".

**Fix:** the description cannot be derived from a single peak step. Either
group the main set's steps by target and describe the pattern, or restrict
`renderDescription` to two-step main sets and refuse (not guess) otherwise.

### D2 — Identity filtering also breaks on shared step objects. `CONFIRMED`

Same line, different trigger. A library author who hoists a reused rest —
`const REST = { secs: 300, lo: 55, hi: 55 }` — and uses it twice in one block
gets both copies removed or kept together, because `!==` compares references.
`4 × 8 min @95–100%` with two hoisted rests renders as
`4 × 8 min at 95–100% FTP, 18 min recovery`, where the truth is 5.

**Fix:** index-based selection, never reference equality, on data authors write
by hand.

### D3 — `.zwo` silently narrows a range to its midpoint. `CONFIRMED`, minor

`renderZwo` emits `Power="0.905"` for a step intervals.icu receives as
`88-93%`. Zwift's `SteadyState` genuinely takes one power, so the concession is
probably right — but Design 4 claims every representation is derived with no
drift, and this one is a real, unrecorded divergence between what the head unit
shows and what Zwift shows. It should be stated, not discovered.

(Checked and clean: the fraction arithmetic produces no floating-point
artefacts across every range in the zone table — `0.905`, `0.815`, `0.655`,
`1.05`.)

### S3 — `dur()` emits metres for long steps. `CONFIRMED`

`get-workout-syntax.ts` defines `Xm` twice: minutes, and — in the
distance table — _"Meters (context-dependent, **>200 = meters**)"_.

The plan's `dur()` never emits the `Xh` / `XhYm` forms the syntax provides,
so a long steady step renders as:

```
10800s -> "180m"    (minutes — fine)
12600s -> "210m"    (>200: parses as 210 METRES)
14400s -> "240m"    (>200: parses as 240 METRES)
```

`long` is a `LibraryPurpose`, its floor is 90 min (`availability/types.ts:59`),
and redistribution reaches `×1.25`. A long ride whose flex step exceeds 200
minutes is inside the range the library must cover, and it exports as a
200-metre-ish distance step.

**Fix:** emit `1h30m` above 60 minutes. One branch in `dur()`.

### S2 — `renderDescription([])` throws. `CONFIRMED`

`TypeError: Cannot read properties of undefined (reading 'lo')` — the no-main
branch reduces with `all[0]` as its seed, which is `undefined` for empty or
step-less blocks. `totalSecs([])` is explicitly tested; its sibling is not.

### A1 — The coverage guard is satisfiable, but Design 3 aims authors at the wrong step. `CONFIRMED`

**Lens: authoring.** The spec's fix is right; its cost depends entirely on one
sentence nobody has read as guidance.

A workout's coverage is exactly the span its **flex step** can absorb
(`FLEX_FRACTION 0.5`, `FLEX_FLOOR_SECS 300`). Design 3 says the flex step is
the longest step in any `repeat === 1` block — _"in practice a warmup or
cooldown"_. **That parenthetical is the defect.** Taken as authoring guidance
it caps every workout at ~10 minutes of coverage, and the guard then demands:

| purpose      | integers to cover | @10 min flex |
| ------------ | ----------------- | ------------ |
| recovery     | 43                | 5            |
| aerobic_base | 123               | 13           |
| threshold    | 101               | 11           |
| vo2max       | 86                | 9            |
| long         | 313               | **32**       |
| **total**    |                   | **70**       |

Against slice 2's budget of 30, that fails the build by construction.

But for `recovery`, `aerobic_base` and `long`, the longest `repeat === 1` step
is not the warmup — it is the **endurance body**, and stretching it is exactly
what those sessions tolerate. Sizing the flex step to the span its purpose must
cover:

| purpose      | flex step                                      | one workout covers | workouts |
| ------------ | ---------------------------------------------- | ------------------ | -------- |
| recovery     | 35 min — the easy body                         | 23–58 min          | 2        |
| aerobic_base | 80 min — the endurance body                    | 55–135 min         | 2        |
| threshold    | 15 min — warmup; the main set _is_ the workout | 68–83 min          | 7        |
| vo2max       | 15 min — warmup; the main set _is_ the workout | 53–68 min          | 6        |
| long         | 150 min — the endurance body                   | 95–245 min         | 3        |
| **total**    |                                                |                    | **20**   |

Twenty tiles everything; forty gives every duration two families to rotate
between. **Slice 2's 30 is fine. The spec's guidance is not** — an author who
follows the parenthetical writes 10-minute warmups onto long rides and misses
coverage by 3.5×, and the guard tells them only that the build is red.

**Fix:** delete "in practice a warmup or cooldown", and state that the flex
step is chosen for the span its purpose must cover — the endurance body for
`recovery`/`aerobic_base`/`long`, the warmup where the main set is the workout
and cannot be stretched.

### A2 — The banded language survived the fix. `CONFIRMED`

The spec's "Coverage is continuous, not banded" section repudiates band
framing, and the Risks table was updated. The Slices table was not:

> | 2 | **The library, first 30** | Every `(purpose, duration band)` covered once… |

An implementer reading the slice table builds the thing the spec argues against
two screens earlier.

### AD1 — The pin is stored one level above the fields it stores. `CONFIRMED`

**Lens: adaptation.** This is in the newest, least-reviewed part of the spec.

The fix stores `workoutId`, `exportedAt`, `purpose` and `durationMins`
**"onto the day"**. But `purpose` and `durationMins` are properties of a
`PlannedWorkout` (`training-plan.ts:76-93`), and a `DaySlot` holds
`workouts: ScheduledWorkout[]` — _"Up to MAX_SESSIONS_PER_DAY sessions"_
(`week-plan/types.ts:29`), which is **2** (`availability/types.ts:31`).

So on a two-session day — a morning recovery spin and an evening threshold
session, both cycling, both `LibraryPurpose` — the pin cannot say which
session it pins, and _"a direct comparison against the day's current values"_
has two answers.

**The repo has already been bitten by this exact shape and wrote it down:**

```ts
// src/lib/week-plan/service.ts:818-826
// A day can now genuinely hold two sessions (MAX_SESSIONS_PER_DAY). This
// signature only names a day, not which of its sessions to move, so a
// multi-session source is refused rather than guessed at…
if (from.workouts.length > 1) return "invalid";
```

`verdict-line.test.ts:373` carries the same lesson for prose. And the spec's
own cited precedent points the other way: `exercises?: StrengthExercise[]` —
the thing it compares the pin to — lives on `PlannedWorkout`, not on `DaySlot`.

**Fix:** put the pin on `ScheduledWorkout`, where its fields already live. That
also makes staleness a same-object comparison, which is what the fix was for.

### AD2 — Red → recovery swap. `HELD`, with a wording caveat

`adapt-day.ts:461` rebuilds the day as `{ ...day, status: "adapted",
workouts: [withPurpose({ ...tWorkout, …, exercises: undefined })] }`. The
`...day` spread means a **day-level** pin survives a swap that deliberately
clears the session-level `exercises` — the comment at `:487-493` explains why
that clearing exists.

I expected this to render a pinned VO₂max workout under a Recovery header. It
does not: stored `purpose: "vo2max"` ≠ current `purpose: "recovery"`, so the
four-field check marks it stale. **The fix does its job here.** The caveat is
only that "stale — re-export" invites re-exporting a workout for a day that no
longer has a hard session on it; "this session was replaced" is the truer
sentence. Moving the pin per AD1 makes this vanish, since the pin dies with the
session.

### AD3 — `readinessBase` restore. `HELD`

`adapt-day.ts:397-402` restores as `{ ...t, workouts: currentBase.workouts.map(...) }`.
A pin survives; the restored workout's `(purpose, durationMins)` return to
their pre-adaptation values; the comparison re-matches and the stale marker
correctly clears. Amber-then-red and recovery-to-green both land right. Tried
and could not break it.

### G1 — "the session's context" has no input. `CONFIRMED`

**Lens: degradation.** The spec says resolution _"picks the FTP matching the
session's context; where context is unknown, it refuses rather than guessing."_

`PlannedWorkout` is `day, sport, type, durationMins, intensity, description,
purpose, minEffectiveMins, exercises?` (`training-plan.ts:76-93`). **There is
no indoor/outdoor field on a planned session, anywhere.** Context is therefore
unknown for every day, and the spec's own rule refuses all of them. The feature
ships and never fires.

### G2 — v0.118 is not a symmetric pair. `CONFIRMED`

The schema is explicit that indoor FTP is a fallback, not a peer to select
between:

```ts
// src/lib/db/schema.ts:589-595
/**
 * v0.118: the indoor/trainer FTP, distinct from the outdoor one above.
 * null = not set. Used ONLY as a fallback anchor when ftpWatts is null —
 * races have no indoor concept in this app, so this can never mean "use it
 * for race day" directly.
 */
ftpWattsIndoor: integer("ftp_watts_indoor"),
```

"Picks the one matching the context" describes a design v0.118 explicitly did
not build. The spec cites v0.118 as its authority while contradicting it.

### G3 — The refusal is also unnecessary where it is stated. `CONFIRMED`

`renderIcu` emits `88-93%` and `renderZwo` emits `0.88`. **Neither renderer
needs an FTP at all** — intervals.icu resolves the percentage against the
athlete's own settings, Zwift against theirs. Matching is on
`(purpose, durationMins)`. So "no FTP" belongs nowhere in the matcher's refusal
set; it only gates slice 3's in-app display of absolute watts, if that is even
wanted.

**Fix for G1–G3 together:** delete FTP from `matchWorkout`'s refusal
conditions. If slice 3 shows watts, resolve with v0.118's real precedence —
`ftpWatts ?? ftpWattsIndoor` — and label the number when it came from the
fallback.

---

## Verdict

**SOUND_WITH_FIXES**, and the two structural fixes are cheap:

1. **Move the pin from `DaySlot` to `ScheduledWorkout`** (AD1). Fixes the
   ambiguity and AD2's caveat together, and puts it where its own cited
   precedent already lives.
2. **`renderDescription` cannot use peak-step identity** (D1, D2). It is the
   one renderer that fails the guarantee Design 4 is named for.
3. **Fix Design 3's flex-step guidance** (A1, A2) — 30 workouts do tile the
   range, but only if the flex step is sized to its purpose. The sentence that
   tells authors how to pick it currently aims them at the warmup.
4. **Drop FTP from the matcher's refusal set** (G1–G3).

Nothing found here invalidates derive-at-read-time, which was the design
decision the workflow actually converged on and the one its cached
`subsystemMap` best supports. Every finding is in the layers built on top of
it — and four of the eleven confirmed ones are in the two fixes applied
yesterday, which is the second piece of evidence in two days that this spec
repays attack.

## Still owed

The three **judges** never ran, and nothing here replaces them: this pass
attacked the winning design, it did not re-score the three rivals against
`fitsRepo` / `survivesAdaptation` / `authoringCost` / `noDrift`, and
`result.tally` is still `{}`. If the runners-up are ever revisited, that is the
gap to close — after 14:50 UTC, and only with `winning` re-seeded from the
current spec.
