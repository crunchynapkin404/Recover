/**
 * Requires every column of a table's SELECT type except an explicit
 * exemption union — the read-side twin of `Carried` in
 * `src/lib/export/carried.ts`.
 *
 * A tool that hand-lists the fields it returns stops mirroring its table the
 * moment a column is added, and nothing fails: the model simply answers with
 * less, fluently. That is not hypothetical. v0.28 added `event_days`,
 * `distance_km`, `elevation_m` and `demand_hours_override` to `races` so the
 * planner could size the week from what the event demands. The planner read
 * them; `get_races` — the tool the coach uses to discuss that very plan —
 * kept projecting the nine fields it was born with, for thirteen releases.
 *
 * Unlike `Carried`, optionality is not the hazard: `$inferSelect` marks every
 * column required already, so `Required<>` would be a no-op and is omitted.
 * The mechanism is the `Omit` — a new column lands in `$inferSelect`, so it
 * lands in this type, so the object literal that lacks it fails to typecheck.
 * For that to bite, the literal must be checked AGAINST this type: annotate
 * the mapping function's return type (`races.map((r): ProjectedRace => ...)`).
 * Building the object untyped and returning it would infer a wider shape and
 * prove nothing.
 *
 * `Exempt` is per table and every entry needs a reason beside it at the use
 * site — a reason about what the consumer needs, not about convenience.
 * Widening this union to silence a type error re-opens the exact hole the
 * type exists to close.
 */
export type Projected<
  T extends { $inferSelect: object },
  Exempt extends keyof T["$inferSelect"],
> = Omit<T["$inferSelect"], Exempt>;
