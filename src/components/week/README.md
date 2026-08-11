# `week/` — week-plan UI shared by Today and Train

Every other directory here is named for the surface that renders it. These
five are not, because they are rendered by two: `/` and `/train` both show a
week, and these are the components that draw it.

The rule (`docs/specs/2026-08-11-2b2-settle-the-ia-design.md`): one owning
surface → that surface's directory; two or more → a directory named for the
domain. Filing them under `today/` or `train/` would make the tree claim a
single owner that does not exist, and the next reader would move them back.

`block-sheet.tsx` qualifies transitively rather than directly: `intake-form`
imports it, and `intake-form` is shared.

If a component here stops being shared, move it to the surface that kept it.
