/**
 * Requires every column of a table's insert type except an explicit
 * exemption union.
 *
 * Drizzle's `$inferInsert` marks a column optional whenever it is nullable
 * or carries a default — which is nearly every column in this schema. So an
 * insert that simply omits a column typechecks cleanly, and the column is
 * silently dropped at runtime. That is not hypothetical: four of the six
 * commits `import-user.ts` has ever received were fixes for exactly that,
 * and `wellness_daily` lost columns twice.
 *
 * `Required<Omit<...>>` strips optionality without touching nullability, so
 * a nullable column's `X | null` still satisfies it — only *absence* is
 * rejected. Columns declared `generatedAlwaysAs` are excluded from
 * `$inferInsert` by Drizzle itself, so generated columns (wellness_daily
 * and chat_messages both have a `search` tsvector) need no exemption and
 * can never be required by mistake.
 *
 * `Exempt` is per table and every entry needs a reason beside it at the use
 * site. Only three reasons are legitimate: `id` (importUserData regenerates
 * every row id), `activities.raw` and `llmSettings.encryptedApiKey` (both
 * dropped by the export side deliberately, so there is nothing to carry).
 * Widening this union to silence a type error re-opens the exact hole the
 * type exists to close.
 */
export type Carried<
  T extends { $inferInsert: object },
  Exempt extends keyof T["$inferInsert"],
> = Required<Omit<T["$inferInsert"], Exempt>> &
  Partial<Pick<T["$inferInsert"], Exempt>>;

import type { UserExport } from "./export-user";

/**
 * `true` iff `T` is exactly `any`. The classic `0 extends 1 & T` probe:
 * substituting `T = any` collapses `1 & T` to `any`, and `0 extends any`
 * is true; for every other `T`, `1 & T` is either `1` or `never`, and `0`
 * extends neither.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * `true` for a single (non-union) `Row` iff that shape cannot prove
 * `Exempt`'s absence: either it has a `string` index signature (so
 * `keyof Row` is `string`, which admits any key including `Exempt`), or
 * `Exempt` names a key it actually declares. `Row extends unknown` is the
 * naked-type-parameter trick that forces this to run once per member when
 * `Row` (or `Exempt`) is itself a union, rather than once over the
 * union as a whole — `keyof (A | B)` is the *intersection* of `keyof A`
 * and `keyof B`, which would hide a key that only one arm carries.
 */
type ArmIsSuspect<Row, Exempt extends string> = Row extends unknown
  ? string extends keyof Row
    ? true
    : Exempt extends keyof Row
      ? true
      : false
  : never;

/**
 * Resolves to `true` only when every member of the (possibly-union) `Row`
 * type is a closed, literal-keyed object shape that provably lacks
 * `Exempt` as a key. Resolves to `never` — failing the assertions below —
 * for the four ways a type can *claim* the key is absent without proving
 * it: `Row` is `any`; `Row` carries a `string` index signature (e.g.
 * `Record<string, unknown>`, whose `keyof` is `string` and so is never
 * provably free of any particular key); `Row` is a union and `Exempt`
 * appears in at least one arm (checked per-arm, since `keyof` of a union
 * only sees keys common to *every* arm); or `Row` simply declares
 * `Exempt` as a key.
 *
 * What this does *not* attempt to prove: a `Row` with no statically known
 * keys at all — literally `unknown`, `object`, or `never` — passes this
 * guard vacuously (`keyof` gives `never`, so no key, including `Exempt`,
 * can be shown present). That is not a gap in practice: `export-user.ts`
 * builds every exempted row from `Omit<schema.X.$inferSelect, ...>`, and
 * a `Row` that vague couldn't be read anywhere else in this file either
 * (no property access on `unknown`/`object` would typecheck) — so it
 * can't arise from a real refactor without failing loudly elsewhere
 * first. The four holes this guard closes are exactly the four in the
 * review that motivated it: `any`, an index signature, a union with the
 * key in one arm, and the named-key case it always caught.
 */
type ExemptionStillJustified<Row, Exempt extends string> =
  IsAny<Row> extends true
    ? never
    : true extends ArmIsSuspect<Row, Exempt>
      ? never
      : true;

const _rawStillStripped: ExemptionStillJustified<
  UserExport["activities"][number],
  "raw"
> = true;
const _apiKeyStillStripped: ExemptionStillJustified<
  UserExport["llm_settings"][number],
  "encryptedApiKey"
> = true;
void _rawStillStripped;
void _apiKeyStillStripped;
