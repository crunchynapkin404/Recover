# Handoff: Recover IA & UX Redesign (Option B)

## Overview

Full information-architecture and density redesign of Recover (github.com/crunchynapkin404/Recover, v0.20). Navigation moves from `Home / Plan / Log / Coach / Journal / Menu` to **`Today / Train / Coach / Body / Menu`**. Every page gets one job; duplicated modules get one home; primary vitals leave accordions; the glass mega-card is reserved for one hero per screen. Two new push-driven bottom sheets: morning check-in and post-ride debrief.

## About the Design Files

The `.dc.html` files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code. The task is to **recreate these designs inside the existing Recover codebase** (Next.js 16 · TypeScript · Tailwind 4 + shadcn · server components · hand-rolled SVG charts), reusing its established components and patterns wherever they exist. Open `Mockups.dc.html` in a browser; screens are labeled 1a–3a. `IA Plan.dc.html` is the rationale document (duplication map, rules R1–R6, page jobs).

## Fidelity

**High-fidelity.** Colors, type, spacing, radii and copy in the mockups are final and drawn from the repo's own tokens (`src/app/globals.css`). Recreate pixel-perfectly with Tailwind utilities; where a mockup value differs from a current component, the mockup wins.

## Authoritative screens (build these)

- **2a — Today** (replaces `src/app/page.tsx` dashboard body)
- **1c / 1d / 1e — Train** Week · History · Fitness segments (merges `src/app/plan/page.tsx` + `src/app/log/page.tsx`)
- **1f — Coach Inbox** + **2d — Coach Chat** (extends `src/app/coach/page.tsx` / `chat-interface.tsx`)
- **1g — Body** (new page; absorbs `src/app/health/page.tsx`, wellness trends from log, journal insights)
- **2b — Activity detail** (restyles `src/app/activity/[id]/page.tsx`)
- **2c — Menu** (restyles `src/app/settings/page.tsx`)
- **1h — Morning check-in sheet**, **1i — Post-ride debrief sheet** (new client components)
- **3a — Desktop Today** (lg+ layout for 2a)
- 1a/1b were density explorations; 2a is the decided composite. Ignore them except as reference.

## Navigation

- `src/components/bottom-nav.tsx` and `sidebar-nav.tsx`: items become `/` **Today** (clock-dial icon), `/train` **Train** (CalendarRange), `/coach` **Coach** (Sparkles), `/body` **Body** (HeartPulse or Activity pulse), `/settings` **Menu** (Settings2). Keep existing pill styling, active dot (`.nav-active-dot`), 8px uppercase labels.
- Routes: `/plan` and `/log` → redirect to `/train?tab=week` / `/train?tab=history`. `/journal` → `/body?tab=journal` (check-in form itself becomes the sheet). `/health` → `/body?tab=labs`.

## Screen specs

### 2a · Today (`/`)

One column, `max-w-lg px-6`, order:

1. **Header** — micro label `TUE JUL 22 · SYNCED 12M` (10px/700/uppercase/tracking-0.2em/white-40; merge `SyncChip` relative time into it, still tappable to sync), `Good morning` 21px/700/tracking--0.03em, avatar 36px glass circle right → `/settings`.
2. **Hero (the only glass mega-card)** — `bg-white/5 border-white/10 rounded-[22px] p-4` + amber outer glow `box-shadow:0 0 60px -20px rgba(245,158,11,0.2)`. Left: single readiness ring 104px (stroke 8, track `rgba(255,255,255,0.07)`, fill = band color, round caps; center: score 30px/700 in band color over 7.5px `READINESS` micro). Right column: band verdict 12.5px/700 in band color (`⚡ Moderate · easy work`), why-line 11px white-55 (`HRV 64 vs 65 baseline · RHR 47 · slept 7:12 · TSB −1.9` — generated from the existing `buildNarrative` inputs, one line, numbers not prose), legend dots Recovery/Sleep 10.5px. Keep `ring-fill` CSS animation. Band colors: green `#10b981`, amber `#f59e0b`, red `#ef4444`, calibrating `rgba(255,255,255,0.4)`. Calibrating keeps the `CalibrationProgress` bar directly under the hero.
3. **Vitals grid** — 2×2, gap 8px. Tile: `bg-white/[0.04] border-white/[0.09] rounded-xl px-3 py-2.5`, flex row space-between: left = label 9px/700/uppercase white-40 + value 19px/700 Geist Mono (unit 10px white-40); right = delta 9.5px/600 (`▲ 7d 63` emerald when good, amber for sleep debt) + 42×14 sparkline (7d, stroke 1.5). Tiles: HRV(ms), RHR(bpm), Sleep(h:mm, delta = debt), Form·TSB (delta = `CTL 58`, sparkline `#8b5cf6`). Tap targets → `/body` scrolled to that trend. **Replaces `RecoveryMetricsAccordion` on this page** (sleep/stages/battery detail moves to Body).
4. **Today's session** — `rounded-[20px] p-4 bg-white/5 border-white/10`. Micro label + intensity chip (border-white/10 pill, 10.5px/700). Title 18px/700 `Ride · 75 min`; description 12.5px white-60. Adjustment note (when `adjustmentReason`): 11.5px amber-85 in `bg-white/[0.04] rounded-xl p-2`. Actions row gap 6px: `Mark done` solid emerald pill (black text 11.5px/700), `Move` / `Shrink` ghost pills (`bg-white/[0.06] border-white/10`). Data: existing `todaySlot` + `DayActions` server actions. No workout → `Rest` + white-50.
5. **Debrief chip** (when pending) — `bg-emerald-500/[0.06] border-emerald-500/30 rounded-[14px] px-3.5 py-2.5`: `How was **{name}**?` 11.5px + `Debrief · 30s →` 10.5px/700 emerald. Opens sheet 1i. Replaces `PendingDebriefCard`.
6. **Race chip** (when next race ≤ 21 days) — same row shape, border `rgba(232,121,249,0.25)`, 🏁 + name/priority + `18 days · form +5 ±4` fuchsia `#e879f9` 11px/700. → `/train?tab=week`. Replaces the full `RaceCountdownCard` here.
7. **Coach brief** — `rounded-[20px] p-3.5`: sparkles icon (violet `#a78bfa`) + `COACH` micro + `Reply →` emerald 10.5px/700; body 12.5px/1.55 white-75, max 3 lines. Data: `getLatestMorningInsight`. → `/coach?thread=…`.

**Removed from Today** (new homes): WeekStrip→Train, WeeklyReview+CoachInsight→Coach inbox, RecentSessionsAccordion+weekly summary→Train, BehaviorTags+Milestones→Body, sleep stages/quality/battery→Body, BodyBattery→Body. Keep `PullToRefresh` wrapper and onboarding empty state.

### 1c/1d/1e · Train (`/train`)

Header `Train` 22px/700 + plan subtitle 10.5px white-50; right: readiness chip (`66 · amber`, band-colored border/dot, 10.5px/700) on Week tab, `+ Log activity` emerald chip on History (→ existing `/activity/log`), range tabs 30/90/180/365 on Fitness. Segmented control: pills 11px/700, active `bg-white/[0.12]`, inactive `bg-white/[0.04] text-white/50`; state via `?tab=` links (extend `buildLogHref`).

- **Week**: existing `WeekStrip` (unchanged); day list as one grouped surface `bg-white/[0.03] border-white/[0.08] rounded-[18px]` with hairline rows (`border-white/[0.06]`), each row: 34px weekday micro, workout 12.5px (`Tempo · 75 min` + detail white-40), status chip (existing `STATUS_CHIP` colors, 9px/700 pill). Today's row highlighted (`bg gradient white/[0.03]`), its `DayActions` inline as small pills + violet `What if?` (`rgba(139,92,246,0.1)` bg, `#a78bfa` text). Below: race row (like Today's race chip, + goal note), `What changed & why · N` as collapsed disclosure (accordions are allowed here — archival), availability intake + remaining-skeleton table keep current logic restyled to the grouped-surface pattern.
- **History**: 7-day stat strip (`7 days · 8.4h · 412 load · 5 sessions · 228 km`, mono 11px in one `rounded-[14px]` row); sport filter chips (existing query-param links); day-grouped list — group = date micro + grouped surface; **row = 56px**: 8×28px rounded color bar (Ride `rgba(59,130,246,0.8)`, Run `rgba(16,185,129,0.8)`), name 12.5px/600 + sub-line 9.5px uppercase white-40 (sport · RPE/feel or `debrief pending`), right mono 11px `1:15 · 78 · 32km`. Row → `/activity/[id]`. Replaces the 300px card-per-activity.
- **Fitness**: stat tiles row (CTL blue `#60a5fa` / ATL red `#f87171` / TSB emerald `#34d399`, 20px mono values + context sub-line) **above** `PmcChart` (chart itself unchanged, add inline legend); `WeeklyLoadBars` (current week `#3b82f6`, rest `rgba(255,255,255,0.18)`); `FitnessStatsRow` (eFTP/Max/W′/Ramp) as one bordered row. No collapsibles.

### 1f/2d · Coach (`/coach`)

Segments `Chat | Inbox · n` (n = unread, emerald). **Inbox (new)**: chronological rail of coach-authored items — morning briefs (☀ amber tile), ride debriefs (✓ emerald), weekly reviews (▤ violet), overtraining warnings (⚠ red), monthly reports (◔ blue). Row: 34px `rounded-[11px]` tinted icon tile (12% bg / 30% border of its hue), title 12.5px/700 + unread dot, timestamp 9.5px white-35, 2-line clamped preview 11px white-55. Tap → opens as a thread. Data: existing `morning-insight`, `weekly-review`, debrief reviews, warnings tables. **Chat**: keep `chat-interface.tsx` behavior; bubbles per `globals.css` (`chat-bubble-ai` white/7 + border white/10, bottom-left 4px; user white/5, bottom-right 4px); artifact = dark inset card (`rgba(0,0,0,0.25)`) with micro title + SVG; add citation line 10px white-40 under AI replies; suggestion chips 10px above composer; composer pill with mic + emerald send.

### 1g · Body (`/body`, new)

Header `Body` + streak chip (`Streak 12d ✓` emerald). Segments `Trends | Sleep | Journal | Labs` (mockup shows the assembled scroll).

- **Trends**: HRV & RHR charts vs baseline — card `bg-white/[0.03] rounded-[18px] p-4`, header = micro label + current/baseline mono (`64ms · 65 ±4`); SVG: baseline band = translucent rect (`rgba(16,185,129,0.08)` HRV / `rgba(59,130,246,0.08)` RHR), dashed centerline, series stroke 0.8. Reuses `wellness-trends.tsx` data + baselines from `daily_metrics`.
- **Sleep**: last-night card — stages bar 14px `rounded-[7px]` segments Deep `#3b82f6` / REM `#8b5cf6` / Light `rgba(59,130,246,0.35)` / Awake `rgba(255,255,255,0.25)` + 9.5px legend with durations; footer row: Consistency · Chronotype · `Tonight: bed by 23:10` (amber). Body-battery curve joins this tab.
- **Journal**: `CorrelationInsights` restyled to plain rows (emoji + behavior 12px, impact `−9% ± 4 next-day` 11.5px/700 red/emerald, `inconclusive · n events` white-40); milestones/streak rows.
- **Labs**: two tiles (Biological age `34 ▼ 4.2 yr` mono 22px + emerald delta; `12 biomarkers / last draw May 12 →`) linking into the existing `BiomarkerList`, `BloodPressureCard`, `HealthUpload`, `HealthManualEntry` (restyled: hairline rows, tiles ≤ `rounded-[16px]`).

### 2b · Activity detail (`/activity/[id]`)

Back link `← Train / History`. Title 21px/700, provenance micro sub. **Stats: 3×2 tile grid** (values 14px mono, labels 8.5px micro) replacing the glass stats card. **Debrief card** (emerald-tinted, `bg-emerald-500/[0.05] border-emerald-500/25`): `DEBRIEF` micro + `RPE 7 · felt normal` emerald 10.5px/700, athlete quote italic white-60, hairline, then `Coach:` (violet bold) review 11.5px/1.55. Stream charts: compact cards, header = name 11px/700 + `avg · max` micro right, SVG heights HR 56 / Power 56 / Elevation 44 (elevation filled `rgba(52,211,153,0.15)`); colors HR `#f87171`, Power `#a78bfa`, Pace `#22d3ee`, Elevation `#34d399` (as today). Laps: CSS-grid table `18px 1fr 44px 44px 40px 48px`, header 9px micro, rows 10.5px mono, work laps white / recovery laps white-75.

### 2c · Menu (`/settings`)

Slim profile row (38px avatar, name 13.5px/700, email 10.5px white-45, `Admin →` emerald micro for owner). Five accordion groups — Integrations (blue grid icon), AI & Coach (emerald sparkles), App (orange dial), Advanced / API (white-45), Data (download icon) — each `bg-white/[0.03] rounded-[18px]`, trigger = icon + 11px/700 uppercase title + **summary line right** (10px white-35: `Claude · Direct · 12 memories`, `2 tokens · 1 webhook · 3 sessions`, `Push on · wake 06:45 · FTP 252`, `Export · Import CSV · backups ✓`) + chevron. Inside: existing cards via the existing `.hairline-list` flattener; connection row = name 12.5px/600 + status sub-line 10px + `active` chip / `Connect →`. Drop the Health escape-hatch link. Footer `RECOVER · SELF-HOSTED · AGPL-3.0` micro centered.

### 1h · Morning check-in sheet (new, client)

Bottom sheet over Today: `bg-[#111113] border-white/[0.12] rounded-t-[28px]`, 40×4 handle, shadow `0 -20px 60px rgba(0,0,0,0.6)`; backdrop dim + blur. Content: title 16px/700 + date; synced strip (`bg-emerald-500/[0.07] border-emerald-500/25 rounded-xl`: `✓ Synced` + `HRV 64 · RHR 47 · sleep 7:12` mono); three sliders Energy/Soreness/Stress (label 11px/600 + value mono, track 6px `bg-white/[0.08]`, fill emerald when ≥6 else white-35, thumb 16px white); behavior tags — usual tags pre-toggled (active = `.tag-active`: `bg-emerald-500/15 border-emerald-500/50 text-emerald-500`; inactive `bg-white/5 border-white/10`), `+ more` expands; note row with mic (Web Speech, fills only); `Save check-in` solid emerald + `Skip` ghost. Submits the existing journal server action. Launched from Today "Check in" and from the morning push.

### 1i · Post-ride debrief sheet (new, client)

Same sheet shell. Title `How was {activity}?` + honesty sub-line (copy from `debrief-form.tsx`). Metrics strip mono (`1:15 · 78 load · 32km · IF 0.86 · 148bpm`). RPE: ten 29px circles, selected solid emerald/black; label `7/10 — hard`. Feel: Strong/Normal/Weak pills, selected `bg-emerald-500/20 text-emerald-500`. Note + mic. `Save & get review` emerald / `Skip` ghost — existing `submitDebrief`/`skipDebrief`. Trigger: push on activity sync (extend the push worker), notification card per mockup.

### 3a · Desktop (lg+)

Existing shell: fixed 216px sidebar (`border-r white/5`, logo 17px/800 tracking--0.04em, items `rounded-[14px] px-3 py-2.5 text-[13px]`, active `bg-white/10`; user row pinned bottom). Today content: header row with sync chip + solid-emerald `Check in · 60s` button; grid `7fr 5fr` gap 20 — left: hero (150px ring, verdict 16px) / vitals 1×4 / week strip row with `8.4h of 9h target · on track · Train →`; right: session card, debrief chip, race chip, coach brief + inbox teaser line. Train/Coach/Body reuse this shell (Coach: inbox rail left of chat at lg+).

## Interactions & behavior

- Segments and filters are **links** (searchParams), preserving other state — extend `src/lib/log-href.ts`.
- Sheets: slide-up 300ms `cubic-bezier(0.21,1.02,0.49,1)`, backdrop fade; swipe-down/backdrop dismiss; respect `prefers-reduced-motion` (globals already kill animation).
- Keep existing animations: `ring-fill` draw-in, `sparkline-animate`, `.reveal` scroll reveal, glass hover lift (hover-capable only).
- Accordion policy: only Menu groups, "What changed & why", remaining skeleton. Never a today-value.
- Empty/calibrating states: keep v0.20 honest empty states; tiles show `—` with track-only rings (never invented values).

## Design tokens (from `globals.css` — unchanged)

- Bg `#0a0a0a`, fg `#fafafa`; card `rgba(255,255,255,0.05)`; borders `rgba(255,255,255,0.1)` (hairlines `0.06`); muted ink white-40/50/55.
- Accents: emerald `#10b981` (primary/positive), amber `#f59e0b`, red `#ef4444`, blue `#3b82f6`, violet `#8b5cf6`/`#a78bfa`, fuchsia `#e879f9` (race), cyan `#22d3ee` (pace).
- Type: Geist (UI), **Geist Mono for all metric values**. Scale: 8.5–10 micro (700, uppercase, tracking 0.1–0.2em) · 11–12.5 body · 14–22 titles · 30–44 hero score. Body 15px, letter-spacing −0.01em.
- Radius scale (new discipline): hero 22–24px · cards 16–20px · tiles 11–14px · grouped-surface rows 0 (hairlines) · pills 999px. Retire blanket `rounded-[2rem]` for data.
- Stat tile spec: ≤64px tall; label micro / value 19–22px mono / delta+sparkline right.

## State management

- No new global state. New tables/fields: none required beyond existing (inbox reads existing insight/review/debrief/warning tables; add a `readAt` column per item type for unread dots).
- Sheet open state: URL-driven (`?sheet=checkin` / `?sheet=debrief&activity=…`) so pushes can deep-link.
- Redirects for retired routes as noted under Navigation.

## Assets

No new assets. Icons are lucide-react (already a dependency): LayoutGrid→clock/gauge for Today, CalendarRange, Sparkles, HeartPulse/Activity, Settings2, RefreshCw, Medal, FlaskConical, BrainCircuit, Mic. Emoji only where the app already uses them (journal tags, 🏁 race).

## Files in this bundle

- `Mockups.dc.html` — all screens (3a desktop; 2a–2d finals; 1c–1i finals; 1a/1b explorations)
- `IA Plan.dc.html` — rationale: diagnosis, duplication map, rules R1–R6, page jobs, ritual flows, density grammar
- `screenshots/` — 2× PNG of every authoritative screen, named `<id>-<screen>.png` (e.g. `2a-today.png`, `3a-today-desktop.png`, `1h-checkin-sheet.png`). Use these as the visual ground truth alongside the specs above.

## Suggested implementation order

1. Nav rename + `/train` `/body` routes with redirects (small, unblocks everything)
2. Today (2a) — biggest visible win
3. Train tabs (1c/1d/1e) — mostly moving existing modules
4. Body (1g) — new composition of existing components
5. Coach inbox (1f) + unread tracking
6. Sheets (1h/1i) + push deep-links
7. Menu & activity-detail restyles (2c/2b)
8. Desktop pass (3a)
