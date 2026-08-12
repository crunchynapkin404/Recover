# Dark-mode delta: `main` (2da5f83) vs v0.99 slice 0

**C5 from the whole-branch review.** The branch's governing constraint is "no
athlete-visible visual change, except the recorded exceptions". Until now that
was never tested against `main` — the pixel-diff cited as proof used a baseline
captured _after_ the token commits, so it compared one task to another.

**Method.** `main`'s single `:root` block **is** the dark theme (no `.dark`
class exists there, and `next-themes` is unused). The branch's `.dark` block is
the dark theme. This compares those two token sets, resolving `var()` chains and
compositing translucent values over the page background `#0a0a0a`. It is exact
CSS arithmetic, not a rendering; **it establishes what changed, not how it
looks.** A browser capture from a `main` worktree is still owed and would add
confirmation on layout and on effects tokens cannot express.

**A blind spot this method has, confirmed by that later browser capture.** The
arithmetic here only ever looks for `var()` chains, `rgba()` spellings and
hex literals — it has no way to notice a bare CSS colour keyword that isn't
wired to a token at all. `.nav-active-dot` (`globals.css:389`) is exactly that
case: its `background`/`box-shadow` move from the literal keyword `white` to
`var(--ink-primary)`, `#ffffff → #f5f5f5` on a 4px dot plus its 12px glow. It
is a real rendered change — confirmed on five phone surfaces by the rendered
pass, `docs/v0.99-slice0-main-diff-verification.md` §6.4 — and it does not
appear anywhere in this document's table, because nothing here was ever
looking for a bare keyword. Recorded as the fifth exception in
`docs/plans/2026-08-11-v099-slice0-foundations.md`.

**Result: 21 token declarations differ; 6 are aliases that render identically;
15 are real rendered changes. One of the 15 is disclosed.**

## Renders identically (alias only, no finding)

`--background`, `--card`, `--primary`, `--ring`, `--sidebar-primary`,
`--sidebar-ring`. Notably `--card`: `rgba(255,255,255,.05)` over `#0a0a0a`
composites to exactly `#161616`, the new `--surface-raised`. That was matched
deliberately and it is good work.

## Real rendered changes

| Token                                     | main     | branch   | factor   | disclosed?            |
| ----------------------------------------- | -------- | -------- | -------- | --------------------- |
| `--border`                                | rgb(34)  | rgb(107) | **3.1×** | no                    |
| `--input`                                 | rgb(34)  | rgb(107) | **3.1×** | no                    |
| `--sidebar-border`                        | rgb(25)  | rgb(107) | **4.3×** | no                    |
| `--muted-foreground`                      | rgb(108) | rgb(138) | 1.3×     | no                    |
| `--viz-muted-ink`                         | rgb(84)  | rgb(138) | 1.6×     | **yes** (exception 3) |
| `--popover`                               | rgb(20)  | rgb(31)  | 1.6×     | no                    |
| `--muted`                                 | rgb(22)  | rgb(38)  | 1.7×     | no                    |
| `--secondary`                             | rgb(30)  | rgb(38)  | 1.3×     | no                    |
| `--sidebar-accent`                        | rgb(30)  | rgb(38)  | 1.3×     | no                    |
| `--foreground` + 5 `-foreground` siblings | rgb(250) | rgb(245) | 0.98×    | no                    |

## Verdict: violated as written

Fourteen undisclosed rendered changes. The constraint as phrased is false, and
the exceptions list is incomplete rather than the code being wrong.

**The two that matter, and why they are arguably the release succeeding:**

- **`--border` / `--input`, 3.1×.** These land on _every bordered element_ via
  `@layer base { * { @apply border-border } }`, and on every `<Input>`,
  `<Select>` and `<Textarea>`. Against the page, rgb(35) on rgb(10) is
  **1.26:1** — failing WCAG 1.4.11's 3:1 for the boundary of a UI component.
  rgb(107) passes on every surface: **3.72:1** on `--surface-base`, 3.40:1 on
  `--surface-raised`, **3.09:1** on `--surface-overlay` — worst case still
  above 3. (An earlier revision of this paragraph quoted only the 3.4:1
  `--surface-raised` figure and rounded main's to 1.2:1.) So the app's borders
  were invisible by
  the same standard the release exists to enforce, and they now are not. That is
  the goal being met, not a regression — but it is a large, app-wide visible
  change and it was never disclosed or looked at.
- **`--muted-foreground`, 108 → 138.** This is precisely the `.label-micro` fix
  (3.8:1 → 5.2:1) applied across **21 `text-muted-foreground` sites** plus every
  shadcn placeholder. Same defect, same fix, far larger surface — and while
  `.label-micro` got its own recorded exception, this did not.

The six `-foreground` tokens moving 250 → 245 (`--foreground`,
`--card-foreground`, `--popover-foreground`, `--secondary-foreground`,
`--sidebar-foreground`, `--sidebar-accent-foreground`) are 2/255 and below any
plausible perceptual threshold. Recorded for completeness, not as a concern.
An earlier revision of this document said five; re-derived independently for
T1, it is six, which is what makes the total 15 rather than 14.

## What must change

Either the exceptions list becomes truthful, or these revert. **Recommendation:
make the list truthful.** Every one of the 14 moves in the direction the release
exists to move — nothing got worse — and reverting `--border` to an invisible
1.2:1 to satisfy a sentence would be the sentence governing the goal instead of
the reverse.

What is still owed regardless: **a rendered capture from a `main` worktree.**
Token arithmetic cannot see layout shifts, the `dark:bg-input/30` interaction
that gives every text field a fill it never had, `color-scheme: dark`'s effect
on native controls, or anything in browser chrome.
