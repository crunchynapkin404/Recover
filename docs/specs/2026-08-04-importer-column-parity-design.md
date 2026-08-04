# v0.39 — The Importer Carries Everything

## The defect

`importUserData` writes each table with an explicit object literal listing the
columns to carry. When a release adds a column, that literal is not updated, and
the column is silently dropped on every subsequent import. The exported file
contains it; the imported account does not.

Fourteen columns across five tables are currently dropped. Every one of them is
listed in `export-user.ts`'s own table-by-table decision comment as **INCLUDED,
verbatim**, with nothing marked stripped:

| Table            | Dropped columns                                                               | Added by                     |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| `wellness_daily` | `sleepingHr`, `hrvSdnnMs`, `readiness`, `hydrationL`, `steps`, `sleepQuality` | migration `0035`             |
| `races`          | `eventDays`, `distanceKm`, `elevationM`, `demandHoursOverride`                | migration `0033_race_demand` |
| `week_plans`     | `availabilityConfirmedAt`, `availabilityPromptedAt`                           | migration `0029`             |
| `chat_messages`  | `readAt`                                                                      | migration `0024`             |
| `body_prefs`     | `levelOverride`                                                               | migration `0033_race_demand` |

The consequences are not cosmetic. The six `wellness_daily` columns are the
entire Apple Health → Companion → intervals.icu route's yield. The four `races`
columns are the inputs from which weekly training volume is derived, so an
imported account's plan is built from a different event than the one the athlete
entered. `body_prefs.levelOverride` silently reverts a manual athlete-level
override to the computed value.

This has shipped repeatedly. `import-user.ts` has six commits in its entire
history, and **four of them are fixes for this same defect**: `startDateLocal`
(`6e2cc4b`), `coach_language` (`5e9bd6a`), nine `wellness_daily` columns
(`585b62a`), and `materializedMins` (`08225e6`). Two thirds of everything ever
done to this file has been patching the same hole one column at a time.

`wellness_daily` is the clearest signal: it was already fixed once, in
`585b62a`, and it is the table dropping the most columns today. A fix that
enumerates columns cannot hold, because the next release adds another one. That
is the argument for changing the mechanism rather than the list.

v0.38.0 found two of the fourteen and deferred them to their own release; this
is that release, scoped to the whole defect rather than to the two columns that
happened to be visible at the time.

## Why the type checker does not catch it

Drizzle's `$inferInsert` requires a column only when it is `.notNull()` _and_
carries no default. Every column in the table above is nullable or defaulted, so
it is optional in the insert type, and omitting it typechecks cleanly. The
existing round-trip test asserts only `.planId` on the imported `week_plans`
row, so it does not catch it either. The defect is invisible to every automated
check the project currently runs.

## Why the existing guard cannot be scaled up

`tests/import-week-plan-column-parity.test.ts` guards `week_plans` by reading
`import-user.ts` as text and parsing the object literal out of it. Its own
comment states the blind spot: it assumes the block keeps its current shape.

That approach was the right call for a test-only change guarding one table. It
is the wrong mechanism for eighteen. Concrete evidence, from writing this spec:
a source-parsing scan built to enumerate the defect **missed
`body_prefs.levelOverride`**, because `body_prefs` is declared at a different
indentation from the tables the parser was written against. A guard that can
miss the very defect it exists to catch, for a reason as incidental as
whitespace, is not a guard. It reports, and only until someone reformats.

## Approach: make omission a compile error

Each mapped object literal in `importUserData` gets an explicit return type
requiring every column the export carries:

```ts
type Carried<
  T extends { $inferInsert: object },
  Exempt extends keyof T["$inferInsert"],
> = Required<Omit<T["$inferInsert"], Exempt>> &
  Partial<Pick<T["$inferInsert"], Exempt>>;
```

Applied at each insert site, so `wellness_daily`'s becomes:

```ts
data.wellness_daily.map((r): Carried<typeof schema.wellnessDaily, "id"> => ({ ... }))
```

Omitting a column is then a `tsc` error naming the missing property, at the line
that dropped it. Adding a column to the schema without carrying it through the
importer fails `npm run typecheck` — which already runs in CI on every pull
request, and which does not depend on the CI database work scheduled as the next
release.

`Required` strips optionality without touching nullability, so a nullable
column's exported `X | null` still satisfies it; only _absence_ is rejected.
Drizzle 0.45 excludes `generatedAlwaysAs` columns from `$inferInsert`
altogether, so `wellness_daily.search` and `chat_messages.search` fall out with
no exemption needed and no risk of the importer trying to write a generated
column.

Once every insert carries this annotation, the source-parsing test is deleted
rather than extended. Keeping both would mean maintaining a fragile restatement
of something the compiler now enforces directly.

### Exemptions, and why each one is not a bug

The exemption list is per table and each entry needs a reason in a comment
beside it. There are only three kinds:

- **`id` — all 18 tables.** `importUserData` regenerates every row's id and uses
  the exported one only to build the old→new mapping. Writing it would collide
  with existing rows in the target database.
- **`activities.raw`** — the bulky raw provider payload, dropped deliberately by
  the export side, which documents that the aggregate columns capture what
  matters. The importer cannot carry what the export does not emit.
- **`llm_settings.encryptedApiKey`** — a credential, dropped by the export side
  for the same reason as the other secret fields. Same argument.

Remapped foreign keys are **not** exemptions. `userId`, `planId`, `weekPlanId`
and the rest are all written, just with rewritten values, so the type already
requires them and correctly keeps requiring them.

## Out of scope, stated deliberately

**No repair path for accounts already imported.** The data was discarded at
insert time and the database holds no record of it, so there is nothing to
recover from. An operator who still has the original export file can import it
into a fresh account after this ships; re-importing into the same account would
duplicate every row, since import is additive rather than a replace. This
release adds no migration and no backfill script.

**No change to what the export emits.** The export side is correct; only the
import side drops columns. Widening the export is a separate question and this
release does not touch it.

## Testing

The compile-time guard is the primary mechanism, and its correctness is checked
by mutation rather than by assertion: deleting a carried column from any insert
must fail `npm run typecheck`. That check is performed and recorded during
implementation for at least one table per exemption class, not asserted to work.

Two runtime tests back it where types cannot reach:

1. A round-trip assertion over `wellness_daily` and `races` — export a row with
   every dropped column populated, import it, and compare column by column
   rather than spot-checking one field the way the current test does. DB-gated,
   so it will not bind in CI until the next release; that is precisely why it is
   the secondary mechanism here and not the primary one.
2. A guard that every exemption is still justified: an exempt column that the
   export side later starts emitting should not stay exempt silently.

`scripts/export-import-drill.ts` typechecks today while omitting `effectiveTarget`
and `materializedMins` entirely. It is in scope: applying the same annotation
there is what stops the drill from certifying a lossy round trip as clean.

## Done when

- All 14 columns are carried, verified by reading the diff against the table in
  this document rather than by the tests alone.
- Deleting any carried column from any insert fails `npm run typecheck`,
  demonstrated.
- `tests/import-week-plan-column-parity.test.ts` is deleted, its guarantee now
  held by the compiler.
- `scripts/export-import-drill.ts` carries the same annotation and passes.
- Full suite green, plus `typecheck`, `lint`, `format:check`, and `build`.

## Risk

The main risk is that annotating eighteen inserts surfaces further columns the
export does not actually emit, turning a contained fix into a wider export-side
question. If that happens, the export side stays unchanged and the column is
exempted with its reasoning recorded, so the release stays scoped; the exemption
is then an input to a follow-up rather than a silent drop.

A secondary risk is that `Carried` interacts awkwardly with a column whose
insert type differs from its select type — the timestamp columns already need
`toDate`/`toDateOrNull` helpers. Those conversions are unchanged by this work,
but a type error at one of them is expected during implementation and should be
resolved by fixing the conversion, never by widening the exemption list.
