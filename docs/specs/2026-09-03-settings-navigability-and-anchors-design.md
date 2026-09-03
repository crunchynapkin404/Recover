# Settings navigability, and the anchors nobody sets

**Status:** design, awaiting review
**Date:** 2026-09-03
**Predecessors:** `docs/2026-08-26-ia-inventory.md`, `docs/2026-08-26-ia-decisions.md`,
`docs/specs/2026-08-26-first-run-coherence-design.md`

## The problem, in one sentence

Every figure Recover computes for running is Low-confidence by construction,
because no athlete has ever set a threshold pace — and the app's own fix links
land them at the top of a six-drawer page whose badge for the drawer they want
says `FTP 250`, which reads as done.

## The evidence

Counted in production 2026-09-02, read-only. Not re-derived here.

| user     | activities | last activity | anchors set | connections |
| -------- | ---------: | ------------- | ----------- | ----------: |
| `0fe820` |        224 | that day      | yes         |           2 |
| `041d7c` |         64 | 2026-07-19    | none        |           0 |
| `ac4319` |         18 | 2026-08-29    | **none**    |           2 |

Against 1,788 wellness rows carrying eFTP and 391 carrying weight. Synced data
flows richly; **one of three users has a `body_prefs` row at all, and nobody
has a threshold pace.**

`n=3` on a self-hosted instance the README calls "one owner and a handful of
friends", one of whom is the owner. "An active connected athlete has no
anchors" is a real signal. It is not enough to build a behaviour model on, and
this design does not build one.

### What the missing anchors cost

With no athlete-set FTP, `resolveFtpAnchor()` falls back to synced eFTP,
stamps `ftpSource: "synced"`, and `racePacing()` drops the target to **Low**
confidence with _"Estimated from recent sessions, not measured."_
(`src/lib/race/pacing.ts:87`, `:145`). With no threshold pace, every run figure
is derived-and-Low **by construction**. The `Set it` fix links already exist.
Nobody follows them.

### Three findings behind that

**1. The fix links do not point at the fix.**
`ANCHOR_FIX = { label: "Set it", href: "/settings" }`
(`src/lib/race/pacing.ts:106`) — bare. The deep-link mechanism exists,
works, and is asserted by a test: `/settings?open=baselines#baselines`
opens the section on load (`src/app/settings/page.tsx:79`, `:421`). It has
exactly **one** caller in the whole app — Body (`src/app/body/page.tsx:174`) —
and it is not the one the athlete arrives through when a number says Low.

**2. The badge reads as done when it is not.**
`baselinesSummary` (`src/app/settings/page.tsx:237`) is built from
`wakeTime · maxHr · ftpWatts` only. Threshold pace, indoor FTP and the four
1RMs are not in it. An athlete with FTP set and no pace sees `FTP 250` on a
collapsed drawer — a true statement that answers a question nobody asked.
This is the inventory's diagnosis stated exactly: _"the accordion labels do
not predict their contents well enough to open only one"_
(`docs/2026-08-26-ia-inventory.md:173`).

**3. Nobody is ever asked.**
`isFirstRun()` returns `false` the moment a connection is active
(`src/lib/first-run.ts:24`). So `ac4319` — 2 connections, 18 activities — was
never shown the first-run treatment and has never been asked for a number.
First run means _"connect something"_, and there is no second question.

### The size, and what it is not

Settings expanded is **7.8 phone screens**, the longest surface in the app
(`docs/2026-08-26-ia-inventory.md:101`), and a reviewer once got lost finding
a card in it. But the same inventory records that **collapsed it is 1.0 screen
— five rows, perfectly legible** (`:173`). The landing state is fine. The 7.8
is what an athlete traverses _because the badges do not let them open only
one drawer._ **This is a prediction defect, not a length defect**, and the fix
is aimed at prediction.

---

## Decisions

| #   | Decision                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `?open=<section>#<field>` becomes the app's anchor-fix vocabulary. `ANCHOR_FIX` and every sibling stop pointing at bare `/settings`.                                 | The mechanism exists, works and is test-guarded, with one caller. Building a second way to reach a section would be the "one resolver, not two" mistake `first-run.ts` names in its own header.                                                                                                                                                         |
| 2   | Each section badge names **what is missing**, not only what is set. Baselines becomes e.g. `FTP 250 · no run pace`.                                                  | The inventory's diagnosis is that labels do not predict contents. A badge that lists only what is set can never say "not here"; it is structurally incapable of the one answer that saves a drawer-by-drawer scan.                                                                                                                                      |
| 3   | Every input in `BodyPrefsCard` gets a stable `id`, and its `<label>` an explicit `htmlFor`.                                                                          | The card uses wrapping `<label className="block">` with no `id` anywhere, so **the fragment target in decision 1 does not currently exist**. Ids are the prerequisite, and they also make `aria-describedby` reachable for the Low-confidence why.                                                                                                      |
| 4   | A new predicate `missingAnchors(userId)` in its own module. **`isFirstRun()` is not touched.**                                                                       | Two different questions. Widening `isFirstRun` to demand anchors would put "Connect a device to begin" in front of an athlete with 64 rides — the exact failure its own comment says it was written to prevent.                                                                                                                                         |
| 5   | The prompt is **sport-gated**: threshold pace is asked for only if the athlete has run activity; FTP only if they ride.                                              | Asking a pure cyclist for a run pace is the same class of error as inventing a wake time, which `body_prefs`' schema comment records v0.9.0 removing: _"a guessed wake time would put an invented bedtime on the dashboard"_.                                                                                                                           |
| 6   | The prompt is a Today block key, present in **all three** state arrays in `BLOCK_ORDER`.                                                                             | `src/lib/today/block-order.ts` declares "REORDER, NEVER HIDE" and `block-order.test.ts` enforces it mechanically. The prompt's subject is not a moment, so `MOMENT_ONLY` does not apply and a two-state array would fail the suite, correctly.                                                                                                          |
| 7   | Dismissal is durable, stored as one nullable timestamp column on `body_prefs`.                                                                                       | The state is about `body_prefs`' own emptiness, so it lives in that row. A dedicated table for one column is the drawer's drawer again. A timestamp rather than a boolean because it costs the same and answers "when" for free.                                                                                                                        |
| 8   | Dismissing removes the **nag**, never the **information**. The badge keeps naming the gap, and the Low-confidence `Set it` links stay, forever.                      | A permanent dismiss that also hid the consequence would leave an athlete with Low figures and no remaining explanation. Dismiss answers "stop asking me on Today", not "tell me my numbers are fine".                                                                                                                                                   |
| 9   | Sessions leaves "Advanced / API" for a **seventh section, "Security"**, whose badge names the live session count.                                                    | Inventory finding: _"'Advanced / API' holds Sessions, which is where an athlete signs other devices out. That is a security action, not an advanced one."_ A seventh row costs the 1.0-screen landing state almost nothing and buys a label that predicts its contents — which is decision 2's whole argument, applied to a section instead of a badge. |
| 10  | **The inventory's "Import has two doors" finding is dismissed, not built.** Verified against the code during this design; see _Findings that did not survive_ below. | Both doors are correct and Export already sits beside Import. Building a fix for a defect that is not there would have moved a working first-run affordance.                                                                                                                                                                                            |
| 11  | This work does **not** claim the Information Architecture roadmap strand.                                                                                            | The strand's two open questions are about whether Season/Fitness/Sleep/Labs deserve to be tabs, parked on telemetry commissioned to answer them. Claiming closure on a Settings fix is the _"narrower true metric replaced the goal"_ failure this repo has now recorded twice.                                                                         |

---

## What gets built

### A. The anchor resolver — `src/lib/anchors-needed.ts`

```
missingAnchors(userId) → { ftp: boolean; pace: boolean; dismissed: boolean }
```

One question, one resolver, beside `isFirstRun()` rather than inside it.
`ftp` is true when the athlete has cycling activity and `body_prefs.ftpWatts`
is null; `pace` is true when they have run activity and
`body_prefs.thresholdPaceSecPerKm` is null. Sport **must** be read through `canonicalSport()`.
`activities.sport` stores the raw provider discipline — a bike ride is `Ride`,
`VirtualRide` or `GravelRide`, never `Bike` — and every consumer canonicalises
at read time (`plan-sport.ts:175`: _"Compare against `canonicalSport(activity.sport)`,
never"_). A naive `sport = 'Bike'` filter here would make the FTP prompt **never
fire for any cyclist**: silent, green, and invisible unless you ride, which is
the exact shape of the bug `canonical-sport.ts`'s header records — 219 live
rides, not one matched. That guard is mutation-tested.

`ftpWattsIndoor` does not satisfy `ftp`. Its schema comment is explicit that
it is a fallback anchor only and _"can never mean 'use it for race day'
directly"_, which is precisely the figure the prompt is about.

### B. The prompt — a Today block

A block, not a modal or a banner. It names the consequence in the app's
existing `missing_input`/`fix` vocabulary, carries the deep link from decision
1, and offers "Not now". It renders `null` whenever the resolver says nothing
is missing, so its presence in all three `BLOCK_ORDER` arrays costs an
anchored athlete nothing — the same argument `dayLog` and `bedtime` already
carry in that file.

### C. Settings — honest badges, live links, one moved section

`baselinesSummary` gains the run anchor and a missing-clause. Sessions moves
out of "Advanced / API" into a new "Security" section per decision 9. Data is
left alone per decision 10.

The seventh section is the riskiest edit in this spec for a reason that has
nothing to do with users: `section-order.test.ts` asserts the six labels in
DOM order **and** cross-checks them against `expandSettingsSections`' own
hardcoded click list in `verify-surfaces.ts`. A section missing from that list
does not fail loudly — it stays collapsed, the capture photographs a closed
row, and `settings-expanded` still passes. That test exists because this is
a silent failure mode. Both lists move in the same commit.

### D. The link surface

`ANCHOR_FIX` in `pacing.ts` and every other bare `/settings` fix target
become section-and-field deep links.

---

## When it refuses

- **No activity in that sport** → no prompt for that anchor. A cyclist is
  never asked for a threshold pace, and a runner is never asked for an FTP.
- **Anchor already set** → no prompt; the badge states the number.
- **Dismissed** → no prompt, ever again. The badge still names the gap and the
  Low-confidence `Set it` links still work (decision 8).
- **No `body_prefs` row** → treated as all-null, which is what two of three
  production users are. Dismissing creates the row.
- **`?open=` names a section that does not exist** → the page renders with
  everything collapsed, which is today's behaviour. Not an error.
- **A fragment points at a field that is not rendered** → the browser does not
  scroll and nothing throws. The section still opens, because `?open=` and
  the fragment are independent.
- **The athlete has activity but no anchors _and_ is genuinely first-run** →
  `isFirstRun()` still wins and the first-run treatment renders instead. The
  prompt never stacks on top of "Connect a device to begin".

---

## What this deliberately does not do

- **Does not restructure Settings into sub-routes.** That is inventory
  question 4 ("Is 'Menu' a tab or a drawer?"), and answering it now discards
  the telemetry commissioned to answer it.
- **Does not decide whether Season, Fitness, Sleep and Labs are tabs.**
  Inventory questions 1 and 3. Still parked, still on purpose.
- **Does not add a search field to Settings.** It would need a
  hand-maintained index of every setting that no test can prove is complete,
  and it treats a prediction defect as a retrieval defect.
- **Does not shorten Settings expanded.** The landing state is 1.0 screen and
  the fix is aimed at letting an athlete open one drawer, not at the depth of
  all of them.
  **CORRECTED 2026-09-03, after measuring:** this section originally read
  "7.8 screens stays 7.8", which was wrong twice over. The surface had already
  grown to **8.21 screens** before this change, and adding a seventh section
  necessarily adds height — it went to **8.31** (6931 → 7014 CSS px, same
  fixture, same capture job). +83 px, the section header only, because
  Sessions moved rather than being duplicated. Claiming a number would not
  move while deliberately adding a section was an internal contradiction this
  spec's own self-review should have caught.
- **Does not change how anchors are derived, or how confidence is computed.**
  `resolveFtpAnchor`, `ftpSource` and the Low/Medium/High bands are untouched.
  This work changes who is _asked_, not what the engine does with the answer.
- **Does not model behaviour from n=3.** No frequency tuning, no re-prompt
  schedule, no engagement heuristic. One ask, one dismiss.
- **Does not claim the Information Architecture strand closed** (decision 11).
- **Does not add ICS export**, the one genuine gap the roadmap names. Unrelated.

---

## Findings that did not survive reading the code

The inventory (2026-08-26) named two Settings defects beyond the badges. Both
were scoped into this work. **One of them is not real**, and it is recorded
here rather than quietly dropped.

**"Import has two doors."** The inventory reads:
_"Today links `/import`, and Settings ▸ Data links `/import` — and Export has
one, inside Data. The two halves of the same job are not in the same place."_

Against the code, on 2026-09-03:

- Today's `/import` link (`src/app/page.tsx:332`) is **inside the `isFirstRun`
  branch**, which opens at `:291` and returns its own `AppShell`. It sits
  beside "Log manually" as one of two ways for an athlete with no data at all
  to get some. It is not a second door on Today; it is the onboarding door,
  and it is the right one.
- Settings ▸ Data (`src/app/settings/page.tsx:567`–`:606`) already renders
  **Data export and Import CSV adjacent, in one section**, under the badge
  `Export · Import CSV`. The two halves of the job are already in the same
  place.

So the finding describes a shape the code does not have. Acting on it would
have removed or rerouted a working first-run affordance to fix a defect that
is not there. **Decision 10 is therefore to build nothing here**, and the
inventory line should be struck when that document is next revised.

**"Sessions is under Advanced / API."** This one holds, and is decision 9.

---

## Verification

- `npx tsc --noEmit` after **every** task. Vitest strips types; it has caught
  two things this week the suite did not.
- **Mutation-test every guard.** Break the thing each test names, confirm red,
  revert. Two tests this week passed against their own mutation.
- `src/app/settings/section-order.test.ts` asserts the section labels in DOM
  order (six today, seven after decision 9) and cross-checks them against the
  capture script's hardcoded click list. **Both halves must move together** or
  the capture silently photographs a closed row.
- `tests/roadmap-figures.test.ts` asserts the migration count against
  `drizzle/*.sql` (47 today). Decision 7 adds one, so the prose must move with
  it.

### Captures

The seeds are already in the right states, which is unusually lucky:

- **`seed-demo.ts` writes no `body_prefs` row at all.** The demo athlete is a
  marathon runner, so the prompt and the missing-pace badge fire on the
  **existing** `today`, `settings` and `settings-expanded` surfaces. No new
  surface is needed to photograph the present state.
- **`seed-cycling-owner.ts` writes `ftpWatts: 250` and no pace.** A cyclist
  with FTP set and no run activity is exactly decision 5's gate, so
  `train-workout` and its siblings photograph the _refusal_ for free.

If a new surface is added anyway, it goes in **`surfaces.yml` AND `soak.yml`**
exception lists together — v0.127.0-rc.1 was killed by its own guard because
#220 updated one and not the other.

`truncate` is CSS and a hidden badge is still in the DOM, so the badge change
must be **looked at** in a capture, not asserted only in a test.

---

## Risks

1. **`body_prefs` row existence stops meaning "has set something".** Decision
   7 makes a dismissal create the row. The production count above used the
   anchor _columns_, so it stands — but any future count must read the
   columns, not `SELECT count(*) FROM body_prefs`. Recorded here because that
   diagnostic was run eight days before this migration lands.
2. **The prompt could read as nagging on an athlete the gate should have
   excluded.** The gate is only as good as `canonical-sport.ts`. A sport that
   maps to neither run nor ride produces no prompt, which is the safe
   direction, but a mis-mapped run would produce a wrong one.
3. **`lg:` is the only breakpoint this repo uses.** The prompt must read at
   every width without introducing `sm:`/`md:` — v0.133.0 fixed a cramped row
   by restructuring for exactly this reason.

---

## Open, and deliberately not decided here

Whether the anchor prompt should also appear on **Train**, where a Low pacing
target is most often read. Today is where the first-run treatment lives and
where an unanchored athlete is most likely to land, so Today is enough to
learn from. Adding Train later is a one-line block-order change; adding both
now means never knowing which one worked.
