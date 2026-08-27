export type LogView = "today" | "week" | "month";

export type LogFilterState = {
  view: LogView;
  month: string;
  range: number;
  sport: string;
};

export type LogHrefOverride = {
  view?: LogView;
  month?: string;
  range?: number;
  sport?: string;
};

export type LogHref = (over: LogHrefOverride) => string;

/**
 * Builds a /log URL that keeps the rest of the filter state intact when
 * only one axis (view, month, range, sport) changes. Shared by ViewTabs,
 * RangeTabs, and the sport-filter chips on the performance-log page — this
 * is the v0.19 fix for hrefs that silently dropped sibling state on click.
 * "" clears the sport filter.
 */
export function buildLogHref(
  current: LogFilterState,
  over: LogHrefOverride
): string {
  const v = over.view !== undefined ? over.view : current.view;
  const m = over.month !== undefined ? over.month : current.month;
  const r = over.range !== undefined ? over.range : current.range;
  const s = over.sport !== undefined ? over.sport : current.sport;
  const q = new URLSearchParams({ view: v, range: String(r) });
  if (v === "month") q.set("month", m);
  if (s) q.set("sport", s);
  return `/log?${q.toString()}`;
}

export const TRAIN_DEFAULTS = { view: "week", range: 90 } as const;

/**
 * The day-windows every trend panel offers, on Body and Train alike.
 *
 * One list, because there were three: Body exported its own from
 * `body/range-tabs.tsx`, Train's `range-tabs.tsx` kept a private copy to
 * RENDER the pills, and `train/page.tsx` kept a third to VALIDATE `?range=`.
 * The last pair is the one that could bite — a range in the tab bar that the
 * page does not accept falls back to 90 with no way to tell why. It lives
 * here so the list and `TRAIN_DEFAULTS.range`, its own fallback member, are
 * read from one file.
 */
export const RANGES = [30, 90, 180, 365] as const;

/** Narrowing guard for a raw `?range=` param — the only reader of RANGES a page needs. */
export function isRange(v: unknown): boolean {
  return (RANGES as readonly number[]).includes(Number(v));
}

export type BodyTab = "trends" | "sleep" | "journal" | "labs";

export const BODY_TABS: BodyTab[] = ["trends", "sleep", "journal", "labs"];

export type BodyHref = (over: { tab?: BodyTab; range?: number }) => string;

/**
 * Builds a /body URL. Body has two axes — the segment and the trend range —
 * and the same rule as everywhere else: changing one keeps the other. The
 * default range is omitted so a plain segment link stays readable.
 */
export function buildBodyHref(
  current: { tab: BodyTab; range: number; night?: string },
  over: { tab?: BodyTab; range?: number; night?: string }
): string {
  const t = over.tab !== undefined ? over.tab : current.tab;
  const r = over.range !== undefined ? over.range : current.range;
  // v0.35: the selected sleep night. "" clears it (back to the latest night),
  // mirroring how buildLogHref's sport override clears a filter. Absent means
  // "latest", so it stays out of the URL in the default case.
  const n = over.night !== undefined ? over.night : (current.night ?? "");
  const q = new URLSearchParams({ tab: t });
  if (r !== TRAIN_DEFAULTS.range) q.set("range", String(r));
  if (n) q.set("night", n);
  return `/body?${q.toString()}`;
}

export type TrainTab = "week" | "history" | "season" | "fitness";

/**
 * The tabs Train currently offers. `"season"` stays a legal `TrainTab` value
 * — it is still a real key in `RETIRED_SURFACE_KEYS` (lib/telemetry.ts) and
 * a real value on `?tab=season` links the app must keep resolving — but it
 * is retired from this list, the set the tab row and the redirect check
 * both read. The Season tab folded into Week and Fitness (see the
 * `tab === "season"` redirect in train/page.tsx).
 */
export const TRAIN_TABS: TrainTab[] = ["week", "history", "fitness"];

/**
 * The /train redirect target for a tab that used to be offered and no
 * longer is, or null when `tab` is live, absent, or unrecognized.
 *
 * Pulled out of train/page.tsx as a pure function because that page has no
 * test harness of its own — deleting `if (sp.tab === "season") redirect(...)`
 * from the page would fail no test there, since `tab` still resolves to
 * "week" through the `TRAIN_TABS.find(...) ?? "week"` fallback and the page
 * looks identical; only the 302 disappears. This is the piece a unit test
 * can actually cover, so the redirect behaviour is the helper's, not the
 * page's.
 */
export function retiredTabRedirect(tab: string | undefined): string | null {
  if (tab === "season") return "/train?tab=week";
  return null;
}

export type TrainFilterState = LogFilterState & {
  tab: TrainTab;
  /** `"next"` when the availability week switcher is in next-week mode; `""` (or absent) otherwise. */
  availability?: string;
};

export type TrainHrefOverride = LogHrefOverride & {
  tab?: TrainTab;
  availability?: string;
};

export type TrainHref = (over: TrainHrefOverride) => string;

/**
 * Builds a /train URL. Same contract as buildLogHref — changing one axis
 * never drops the others — with the segment (tab) as a fourth axis, so
 * flipping Week → Fitness → History round-trips back to the sport filter
 * and month the athlete had chosen. Defaults are omitted to keep the URL
 * readable; "" clears the sport filter. `availability` follows the same
 * rule: set it to "next" to link straight into the week switcher's
 * next-week mode (see the "Set next week's availability" link on the week
 * tab) without dropping whatever else the current URL already carries.
 */
export function buildTrainHref(
  current: TrainFilterState,
  over: TrainHrefOverride
): string {
  const t = over.tab !== undefined ? over.tab : current.tab;
  const v = over.view !== undefined ? over.view : current.view;
  const m = over.month !== undefined ? over.month : current.month;
  const r = over.range !== undefined ? over.range : current.range;
  const s = over.sport !== undefined ? over.sport : current.sport;
  const a =
    over.availability !== undefined
      ? over.availability
      : (current.availability ?? "");
  const q = new URLSearchParams({ tab: t });
  if (v !== TRAIN_DEFAULTS.view) q.set("view", v);
  if (v === "month") q.set("month", m);
  if (r !== TRAIN_DEFAULTS.range) q.set("range", String(r));
  if (s) q.set("sport", s);
  if (a) q.set("availability", a);
  return `/train?${q.toString()}`;
}
