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
 * Avatar chip colours, per brand — ink on its own tint, both themes.
 * Migrated onto tokens in Task 5. Exported so connector-card.test.tsx can
 * pin the current values — test-visible state, not part of the public
 * component contract. No border: the tint is the chip now, and a
 * border-hairline ring around a filled tint reads as a second box.
 */
export const TONE_CHIP: Record<ConnectorTone, string> = {
  strava: "bg-connector-strava-tint text-connector-strava-ink",
  whoop: "bg-connector-whoop-tint text-connector-whoop-ink",
  withings: "bg-connector-withings-tint text-connector-withings-ink",
  oura: "bg-connector-oura-tint text-connector-oura-ink",
  apple: "bg-connector-apple-tint text-connector-apple-ink",
};

export const connectorPillClass =
  "rounded-full border border-hairline bg-surface-overlay px-3 py-1.5 text-label font-bold uppercase tracking-wider transition-colors hover:bg-surface-selected disabled:opacity-50";

export const connectorGhostClass =
  "rounded-full border border-hairline px-3 py-1.5 text-label font-bold uppercase tracking-wider text-ink-muted transition-colors hover:bg-destructive-tint hover:text-destructive-ink disabled:opacity-50";

export const connectorCtaClass =
  "rounded-full bg-accent px-4 py-2 text-label font-bold uppercase tracking-wider text-accent-foreground transition-colors hover:opacity-90 disabled:opacity-50";

export const connectorBadgeClass =
  "rounded bg-surface-overlay px-2 py-1 text-label font-bold uppercase tracking-widest text-ink-muted";

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
      {/*
       * flex-wrap (Task 11 fix): the token migration moved
       * connectorPillClass/GhostClass/CtaClass off a 10-pixel arbitrary
       * size and connectorBadgeClass off an 8-pixel one, both onto the
       * shared text-label token (12px) — correctly, since 12px is the
       * floor — but padding stayed the same. At 390px that grew `actions`
       * (SYNC/DISCONNECT, or "Set X_CLIENT_ID") past what's left after the
       * avatar+name column, and without wrap the row silently overflowed
       * the viewport — DISCONNECT's pill clipped off-screen, unreachable
       * without horizontal scroll. axe's color-contrast rule never sees
       * layout overflow, so this shipped with a clean confirmed=0. Real
       * capture: Strava and Whoop's DISCONNECT pill clipped at
       * settings-expanded-dark-phone before this fix. flex-wrap drops
       * `actions` to its own line instead of shrinking or clipping —
       * "restated," not shrunk below the floor.
       */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${TONE_CHIP[tone]}`}
          >
            <span aria-hidden className="text-body">
              {glyph}
            </span>
          </div>
          <div>
            <p className="text-caption font-bold">{name}</p>
            <span className="text-label font-bold uppercase tracking-wider text-ink-muted">
              {subtitle}
            </span>
          </div>
        </div>
        {actions}
      </div>

      {status && (
        <p
          role="status"
          className={`mt-3 text-label ${
            status.ok ? "text-ink-secondary" : "text-destructive-ink"
          }`}
        >
          {status.message}
        </p>
      )}

      {children}
    </div>
  );
}
