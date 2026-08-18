import { CalendarRange, Gauge, Server, Sparkles } from "lucide-react";

const REPO_URL = "https://github.com/crunchynapkin404/Recover";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * What an athlete sees before they have an account. Copy is taken from
 * README.md rather than written fresh, so the landing page and the repository
 * cannot drift into describing two different products.
 *
 * ALL TEXT HERE IS UN-CARDED, sitting directly on `.mesh-gradient`. That has
 * one hard consequence: `--ink-muted` is not available. It measures below the
 * 4.5:1 AA floor on this backdrop, so the ramp here stops at
 * `--ink-secondary`. tests/contrast-guard.test.ts proves it against the
 * composite this page actually paints — login declares its own blob layers at
 * 10% (emerald + indigo), NOT AppShell's 5% pair, so it is measured
 * separately rather than assumed to inherit AppShell's numbers.
 */
const FEATURES = [
  {
    icon: Gauge,
    title: "Readiness from your own baselines",
    body: "A daily score computed from your history — not population norms. HRV, resting heart rate and sleep, measured against what is normal for you.",
  },
  {
    icon: Sparkles,
    title: "Your Claude, your training data",
    body: "A built-in MCP server. Ask Claude how your week went, or whether to still do intervals tomorrow — over a scoped, revocable token you issue.",
  },
  {
    icon: CalendarRange,
    title: "Training load and a living week",
    body: "A plan that adapts to how you are actually recovering, instead of a fixed block written weeks ago.",
  },
  {
    icon: Server,
    title: "Self-hosted, no subscription",
    body: "Your hardware, your data, no wearable lock-in. Start with manual entry alone, import a CSV, or connect intervals.icu and Strava.",
  },
] as const;

export function LandingInfo() {
  return (
    <div className="relative z-10 mt-14 w-full max-w-2xl">
      <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon
              aria-hidden
              strokeWidth={1.5}
              className="mt-0.5 size-5 shrink-0 text-accent"
            />
            <div>
              <h2 className="text-caption font-bold tracking-tight text-ink-primary">
                {title}
              </h2>
              <p className="mt-1 text-caption leading-relaxed text-ink-secondary">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-label text-ink-secondary">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm font-bold underline underline-offset-4 transition-colors hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Source on GitHub
        </a>
        <span aria-hidden>·</span>
        <a
          href={LICENSE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm transition-colors hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          AGPL-3.0
        </a>
        <span aria-hidden>·</span>
        <span>Self-hosted</span>
        <span aria-hidden>·</span>
        <span>Invite only</span>
      </div>
    </div>
  );
}
