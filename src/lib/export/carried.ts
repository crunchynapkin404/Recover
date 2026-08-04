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
 * Resolves to `true` only while `Exempt` is genuinely absent from the
 * export's row type. If the export ever starts emitting an exempted
 * column, this resolves to `never`, the assertions below stop compiling,
 * and the exemption has to be removed rather than silently kept.
 */
type ExemptionStillJustified<Row, Exempt extends string> =
  Extract<keyof Row, Exempt> extends never ? true : never;

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
