import type { ReactNode } from "react";

/**
 * The chrome five Settings connector cards duplicated verbatim — wrapper,
 * header row, avatar chip, name, subtitle, an actions slot and the status
 * paragraph. whoop-card.tsx and withings-card.tsx were the same 100 lines
 * with different nouns; oura, strava and apple-health were that plus a body.
 *
 * Extracted in v0.106.0 (2b.4 slice 5 phase B) BEFORE the redesign touched
 * any class, so the migration edits this markup once instead of five times
 * and a mistake in the extraction shows up against unchanged markup.
 *
 * The four class constants below are the button shapes the same five cards
 * duplicated. They are exported as strings rather than components because
 * the call sites are variously <button>, <a> and form submits, and a
 * polymorphic component would cost more than it saves. Tailwind v4 compiles
 * any class that appears as a literal string in source, so these compile —
 * and the source-scanning guards in tests/type-scale-guard.test.ts see them
 * exactly as they see inline ones.
 *
 * CORRECTION (Task 2 fix round 1, 2026-08-17): the extraction above is
 * byte-identical for Withings, Oura and Apple Health, but NOT for the glyph
 * span on Whoop and Strava. Whoop's span was `text-sm font-black
 * tracking-tight` (14px, bold, tight); Strava's was `text-xl text-orange-400`
 * (20px). Both are flattened to the single `text-base` (16px) below, with
 * colour moved onto TONE_CHIP's parent chip instead of the span (which is
 * genuinely byte-identical for the other three tones, whose spans were
 * already `text-base text-{colour}`). This is deliberate, ruled on
 * explicitly rather than an oversight this comment failed to catch: a
 * one-character monogram sitting in its own 40px tinted chip does not need
 * a third signal on top of size and brand ink, so the shell owns the
 * glyph's type and renders all five at one size. Task 5 gives the chip
 * itself — not the glyph — each brand's ink token.
 */

export type ConnectorTone = "strava" | "whoop" | "withings" | "oura" | "apple";

/**
 * Avatar chip colours, per brand. Migrated onto tokens in Task 5. Exported
 * so connector-card.test.tsx can pin the current values — test-visible
 * state, not part of the public component contract.
 */
export const TONE_CHIP: Record<ConnectorTone, string> = {
  strava: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  whoop: "border-white/20 bg-white/10",
  withings: "border-teal-400/20 bg-teal-400/10 text-teal-300",
  oura: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  apple: "border-red-400/20 bg-red-400/10 text-red-300",
};

export const connectorPillClass =
  "rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-50";

export const connectorGhostClass =
  "rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50";

export const connectorCtaClass =
  "rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50";

export const connectorBadgeClass =
  "rounded bg-white/5 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-white/50";

export interface ConnectorCardProps {
  name: string;
  tone: ConnectorTone;
  glyph: ReactNode;
  subtitle: ReactNode;
  actions?: ReactNode;
  status?: { message: ReactNode; ok: boolean } | null;
  children?: ReactNode;
}

export function ConnectorCard({
  name,
  tone,
  glyph,
  subtitle,
  actions,
  status,
  children,
}: ConnectorCardProps) {
  return (
    <div className="glass rounded-[2rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl border ${TONE_CHIP[tone]}`}
          >
            <span aria-hidden className="text-base">
              {glyph}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold">{name}</p>
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              {subtitle}
            </span>
          </div>
        </div>
        {actions}
      </div>

      {status && (
        <p
          role="status"
          className={`mt-3 text-xs ${
            status.ok ? "text-white/60" : "text-red-400"
          }`}
        >
          {status.message}
        </p>
      )}

      {children}
    </div>
  );
}
