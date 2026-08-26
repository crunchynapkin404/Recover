# First-run coherence — design

Phase 6 strand one, the first of the four Experience cycles. Written
2026-08-26 against v0.119.0. Every claim below was checked by creating a real
dataless owner on a scratch database, signing in as them, and reading all four
tabs — not by reasoning about what the code probably does.

## The problem is narrower than "there is no onboarding"

There is onboarding, and it is good. `src/app/page.tsx:279` gates on
`!connection && wellness.length === 0` and renders a welcome card: a heading,
three ranked data paths with the recommended one highlighted, and an honest
"Recover needs 14 days of HRV & resting HR to calibrate your readiness score —
it'll show a day-by-day countdown while it learns your baseline."

**The problem is that this exists on exactly one tab out of five, and the nav
is fully live from the first second.** A new athlete who clicks around before
connecting anything — which is what people do — meets four different flavours
of nothing, none of which routes back to the one screen that would help:

| Tab       | What a dataless owner actually sees                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Today** | The welcome card. Works.                                                                                                                                                                                               |
| **Train** | `calibrating` · "No plan yet — generate one from a race goal, or plan just this week." (`components/train/plan-empty.tsx:11`)                                                                                          |
| **Body**  | "Not enough readings in this range yet." **three times** — once per card (`components/body/baseline-trend-card.tsx:90`) — plus a fourth page-level "No wellness readings in this range yet." (`app/body/page.tsx:371`) |
| **Coach** | "The AI coach needs an LLM key to work." (`components/coach/chat-interface.tsx:327`) A wall with no way out.                                                                                                           |

## The mechanism to use already exists

`src/lib/uncertainty.ts` defines the house vocabulary, and it fits this
problem exactly:

```ts
| { kind: "calibrating"; have: number; need: number; unit: CalibratingUnit }
| { kind: "missing_input"; needs: string; fix?: { label: string; href: string } }
| { kind: "not_applicable"; why: string }
```

`<Unavailable full>` (`components/ui/unavailable.tsx:28`) already renders any
of these as a full-panel `EmptyState`, and `missing_input` already carries a
**fix link**. The `calibrating` variant already renders "Calibrating — day N
of 14" — which is precisely the day-by-day countdown the welcome card
promises.

So this strand builds no new mechanism. The four tabs hand-roll strings
instead of using the vocabulary the project already standardised on in
`docs/specs/2026-08-08-uncertainty-vocabulary-design.md`.

## Decisions

| #   | Decision                                                                                              | Why                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Extract `!connection && wellness.length === 0` from `page.tsx` into one exported predicate            | One source of truth for "this athlete has nothing yet", the same move `resolveFtpAnchor()` made for FTP. Four tabs are about to ask the same question; four inline copies is the drift shape this project keeps having to undo. |
| D2  | **First-run is strictly gated on no connection AND no wellness at all**                               | The safety of the whole change. See below — this is the requirement most likely to be got wrong, and the one a reviewer should attack hardest.                                                                                  |
| D3  | The four tabs render `<Unavailable full>` with `kind: "missing_input"` and a `fix` link back to Today | Reuses the house component and vocabulary. A wall becomes a door, in one voice, without inventing a second empty-state dialect.                                                                                                 |
| D4  | Body's three per-card messages fall silent when first-run; one page-level statement remains           | Four near-identical sentences on one screen is the clearest defect here. The cards have nothing distinct to say when the athlete has no readings at all.                                                                        |
| D5  | Today's welcome card is not touched                                                                   | It works. Redesigning it is not this strand.                                                                                                                                                                                    |
| D6  | First-run surfaces get real capture coverage, against a dataless seeded account                       | Non-negotiable — see "Why coverage is not optional".                                                                                                                                                                            |

## D2, expanded: the distinction that makes this safe

**First-run is not the same state as an empty view**, and conflating them is
the way this change goes wrong.

"Not enough readings in this range yet" is **correct** for an established
athlete who selects a 30-day range with a gap in it. So is "No plan yet" for
someone between seasons. Replacing those unconditionally would tell a
two-year user to go connect a device — wrong, and faintly insulting.

The first-run treatment therefore applies **only** when the athlete has no
connection _and_ no wellness rows at all. Every other empty state keeps
today's wording untouched. A test must pin both directions: first-run gets the
new treatment, and an established athlete with an empty range does not.

## Why coverage is not optional

The welcome card carries this comment, written after a whole-branch review in
August 2026 found it:

> "this branch sat inside the file the rest of this slice rewrote, but no
> capture could reach it — every capture ran against an account with data — so
> it kept every pre-slice utility — sub-floor pixel sizes, glass, white-alpha
> inks, a raw emerald accent — straight through."

Every surface in `scripts/verify-surfaces.ts` seeds `seed-demo.ts` first, so
**no capture has ever photographed a dataless account.** Adding four new
first-run states into that blind spot would repeat the exact failure the
comment records — and this project has now hit the same class three times: the
race-pacing line nobody had photographed (v0.117.0), the truncated settings
PNGs (2026-08-26), and this.

**The ordering constraint is real and is part of this design, not an
implementation detail.** The existing surfaces need a seeded account _with_
data; these need one _without_. They cannot share an athlete, exactly as
`seed-confirmed-race.ts` could not share a draft with `seed-two-race.ts`. The
options are a second seeded user or a separate capture pass, and the
implementation plan must pick one deliberately rather than discover the clash.

## Out of scope

- **The welcome card's own design.** It works.
- **Funnelling or gating.** Tabs stay reachable. A new athlete is allowed to
  look around before committing to a data source.
- **The 14-day calibration wait itself.** Worth noting that it only binds
  manual loggers — import and every connector backfill history, so two of the
  welcome's three paths clear it instantly — but shortening or reframing it is
  a different question from "the tabs do not cohere".
- **Coach's LLM-key requirement.** The fact stays; only its presentation
  changes. Making the coach work without a key is a separate feature.
- **The other three Phase 6 strands** (IA, flow and friction, visual polish),
  each of which gets its own cycle.

## Testing

- The predicate, both directions: dataless owner is first-run; an athlete with
  a connection but no wellness is **not**; an athlete with wellness but no
  connection is **not**.
- Each of the four tabs renders the first-run treatment when the predicate
  holds, and its existing wording when it does not. The second half is the one
  that protects established users and is the more important assertion.
- Body specifically: exactly one absence statement when first-run, and the
  pre-existing three-card behaviour when the athlete has readings outside the
  selected range.
- Capture coverage per the section above.

**What tests cannot settle:** whether the result actually feels welcoming.
This spec is binding on the predicate gate and the capture coverage, which are
correctness-shaped. It is deliberately not binding on wording or layout —
those should be built, screenshotted, looked at, and changed.
