# v0.99 design reference

Two static HTML files, openable from disk with no build step and no network
access. They are the reference slices 1-9 of the v0.99.0 redesign build
against.

- `v0.99-today.html` — Today in its three states (morning, just after a session
  lands, evening). The smallest surface.
- `v0.99-train.html` — Train's four tabs. The largest and densest surface, and
  the one that matters: the 12px type floor does not fit Train's content as
  shipped, so this file works that collision out in the open and records every
  editorial decision it took to resolve it.

Each file also carries the system itself, so a reviewer can judge the
foundations and not only the picture: the seven-step type scale rendered at
every step with its px value, and the four-step ink ramp with measured contrast
against the surface it sits on.

## The tokens here are copies

**`src/app/globals.css` is the source of truth.** The values in these files
were transcribed from it and will drift. If the two disagree, the stylesheet is
right and these files are stale — and `tests/contrast-guard.test.ts` enforces
the stylesheet, not these mockups.

## What they are not

Not a specification of final pixels, and not a component inventory. They settle
the type scale, the ink ramp and the density questions that are expensive to
re-decide nine times. Everything below that level is each slice's own call,
made against the real components with the screenshot and axe passes in
`scripts/verify-surfaces.ts`.

## Rules they demonstrate

- **12px is a hard floor.** Nothing renders below it. Where a mockup shows a
  smaller number it is prose quoting the old value — `.label-micro`'s hardcoded
  `10px`, for instance — not type on the page.
- **`--hairline` is never legal on text.** It exists at roughly 3:1 for
  dividers, borders and icon strokes, which is what WCAG 1.4.11 asks of
  non-text. It appears as a labelled swatch in the ink ramp so its role is
  visible; that swatch is the one place it wears text, deliberately.
- **No new figure.** Every number shown is one the app already computes.
  Presentation may change; claims may not.
