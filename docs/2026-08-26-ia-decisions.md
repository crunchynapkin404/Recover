# Information architecture — the first two decisions

**Phase 6, strand 2.** Companion to `docs/2026-08-26-ia-inventory.md`, which
measured the problem and deliberately settled nothing. This settles the two
questions that measurement cannot answer, and says plainly why the other two
are still open.

Written 2026-08-26, after the inventory and the tab-level telemetry shipped
in v0.121.

---

## What this does not rest on

**There is no usable usage evidence yet, and none is claimed here.**

`surface_views` on the dev database looked promising — 432 views of
`settings`, the highest of any surface. It is worthless for this purpose, in
three independent ways:

- The window is 2026-08-16 to 08-19 across 2–3 users: the days the capture
  script was being run heavily. Settings has four captured surfaces
  (`settings`, `settings-expanded`, `settings-connect-errors`,
  `settings-token-created`), so the script alone visits it four times per run.
- `telemetry.ts`'s own comment warns that `next dev` link-prefetch completes
  real requests against sibling routes, inflating counts against actual
  clicks.
- A second session confirmed it polluted the same table on 2026-08-26 while
  verifying an unrelated layout fix — repeated authenticated loads across
  seven viewport widths, plus a failed-login pass.

So the number that most looked like evidence for "Settings is heavily used"
is an artefact of the tools measuring it. **Both decisions below rest on
structure, and are labelled as such.** The tab-level counter shipped in
v0.121 starts earning real data now; it had none to give yet.

---

## Decision 1 — "Menu" becomes "Settings"

`NAV_ITEMS`' fifth entry was labelled **Menu** and pointed at `/settings`,
whose own `<h1>` also read **Menu**.

**The page renamed itself to agree with the tab.** That is the tail wagging
the dog, and it is the whole confusion in one line: "Menu" promises a hub of
destinations, and what is behind it is a settings page. Today / Train / Coach
/ Body each name the job they open. The fifth did not.

Changed: the nav label, the page's `<h1>`, and the `aria-label` on Today's
avatar button — which also lands on `/settings` and said "Menu", the version
of the mismatch that matters most, because a screen-reader user hears only
that string before following the link.

Same slot, same icon, same route. **Only the promise changed**, so there is
no muscle memory to relearn.

### What was considered and rejected

**Dropping Settings from the nav entirely**, leaving four job tabs and
reaching settings through the avatar. It is the tidier IA: settings is
low-frequency and occupies one of five scarce mobile slots.

Rejected for now, on a fact rather than a preference: `SidebarNav` is `lg:`
only, so **on a phone there is no avatar row at all**. Removing the tab would
leave mobile with no settings entry until one was designed and built. That is
a real piece of work, it disturbs navigation every existing user has muscle
memory for, and there is no usage evidence to justify it. Revisit when the
counter has data.

Noted and left alone: at `lg`+ the nav item and the sidebar's pinned avatar
row now both read as Settings. Mild redundancy, and conventional — an avatar
that opens account settings is a pattern people expect.

---

## Decision 2 — the athlete's baselines get their own section

`BodyPrefsCard` lived inside **App**, between the push toggles and LLM usage.

It holds usual wake time, sleep target, max HR, FTP outdoor, FTP indoor,
threshold pace, and four 1RMs. **None of that is a setting about the app.**
They are the athlete's own baselines — the inputs every engine figure is
computed against — and the roadmap's goal sentence turns on exactly that
word:

> Baselines are the athlete's own, not population norms.

It ended up under "App" because it was not an integration, not the coach, not
an API and not data. **"App" was the drawer's drawer**, and the inventory
records an implementer losing real time finding a card in it.

Now: a sixth section, **Your baselines**, placed **second — directly under
Integrations**. That order is the argument. Integrations bring the athlete's
data in; baselines are what it is measured against; everything below is
peripheral to whether a number is right. When a figure looks wrong, this is
the page to reach, and it was five screens down under a label that did not
name it.

Three supporting changes:

- **The badge summary split.** `appSummary` was showing `wake 06:30 · FTP 250`
  under a section called "App" — part of what made the thresholds unfindable.
  App now summarises push state only; the new `baselinesSummary` shows wake,
  max HR and FTP, so a closed section still answers "is this set?".
- **The section is URL-addressable**: `/settings?open=baselines#baselines`
  opens it. Href-carried state is the property the tab pattern was chosen for
  (CHANGELOG, "A tab pattern, chosen rather than inherited"), and a section
  reachable only by clicking would not honour that contract. The tab-level
  telemetry depends on the same property.
- **Body links to it.** `/body` had exactly one inbound link in the entire app
  and no outbound one. An athlete looking at a resting-HR band and thinking
  "my max HR is wrong" had no path from there to the field that sets it. The
  link sits in Body's existing header row rather than a new one, because
  Body ▸ Trends already spends two rows of chrome before its first number.

### Why not move it to Body outright

Body is the surface _about_ the athlete's body, and the argument for putting
the form there is real. Two reasons not to, for now:

1. Body's four tabs are all read-only trend and history views. A form is a
   different mode, and Body has no place for one that would not be a fifth
   tab.
2. **Whether Body should have four tabs is one of the parked questions.**
   Adding a fifth while questioning the four would be deciding that question
   by accident, in the direction the evidence has not yet been gathered for.

The link achieves most of the benefit and forecloses nothing.

---

## Still parked, on purpose

The inventory's questions 1 and 3 — **are Season, Fitness, Sleep and Labs
really tabs**, at one screen each while Train ▸ Week runs to 4.7? — stay open
until the counter has data.

This is not indecision. They are precisely the questions evidence can settle,
the instrument to settle them shipped a few hours ago, and a restructure
decided this week would throw away the evidence it was built to collect. The
two decided above are the two that counting could never have answered.

---

## The constraint any further work inherits

**Every destination must keep working as a URL.** That is what the tab
pattern was chosen for, it is what `buildTrainHref`/`buildBodyHref` exist to
preserve, and the v0.121 telemetry reads the resolved tab out of exactly that
state. An IA change that moved a destination somewhere unaddressable would
break the instrument built to evaluate it.

`train/view-tabs` is worth naming here because it is easy to get wrong. It is
not a `SegmentedTabs` caller — it carries date logic the shared component has
no business holding — but both of its rows are plain `<Link>`s with
`aria-current`, so it honours the contract anyway. What it does not share is
the implementation, not the promise.

## Verification

- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`
  (2984 passed, 1 expected fail, 1 skipped, with a database) all clean.
- **Captured and looked at**, 12 images across both themes and both
  viewports: **0 confirmed axe defects in 12/12 combinations**, so the
  ratchet — the one constraint this strand was allowed to bind itself with —
  holds. (589 indeterminate nodes, all `color-contrast`, which never gates:
  axe cannot compute a ratio over this app's gradient backgrounds.)
- **Body's header was measured in the crowded case**, because the capture
  could not show it: the dev owner has no streak, so the screenshot only ever
  proved the easy half. Injecting the widest realistic chip
  ("Streak 180d ✓", 115.06 px) next to the new link (109.66 px) at 390 px:

  |                   | before | after |
  | ----------------- | -----: | ----: |
  | row `scrollWidth` |    342 |   342 |
  | row `clientWidth` |    342 |   342 |

  No overflow, and `h1`, chip and link all report `top: 32` against a
  `rowHeight` of 30 — one line, nothing wrapped. This mattered because the
  inventory's own finding was that Body's header is already tight.

- **One regression this introduces, stated rather than buried:** collapsed
  `/settings` was 844 CSS px — exactly one phone viewport, no scroll. The
  sixth section makes it **851 px**, so the landing screen now scrolls by
  7 px. That is a real if small cost of the section split, accepted because
  the alternative is leaving the athlete's baselines unfindable. Worth
  revisiting if a seventh section is ever proposed.
- `src/app/settings/section-order.test.ts` is new and guards the part that
  fails silently: `expandSettingsSections` in `scripts/verify-surfaces.ts`
  hardcodes the labels it clicks open, and **a section missing from that list
  does not fail — it stays collapsed**, so the capture photographs a closed
  row and the axe run audits nothing inside it while `settings-expanded`
  still passes. Both directions are asserted, and both were verified by
  mutation.
