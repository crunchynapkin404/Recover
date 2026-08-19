import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SegmentedTabs } from "./segmented-tabs";

const TABS = [
  { key: "week", label: "Week", href: "/train?tab=week" },
  { key: "history", label: "History", href: "/train?tab=history" },
  { key: "season", label: "Season", href: "/train?tab=season" },
] as const;

const PILLS = [
  { key: 30, label: "30d", href: "/train?range=30" },
  { key: 90, label: "90d", href: "/train?range=90" },
] as const;

describe("SegmentedTabs", () => {
  it("renders one link per item, with its own href", () => {
    const html = renderToString(<SegmentedTabs items={TABS} active="week" />);
    expect(html).toContain('href="/train?tab=week"');
    expect(html).toContain('href="/train?tab=history"');
    expect(html).toContain('href="/train?tab=season"');
    expect(html.match(/<a /g)).toHaveLength(3);
  });

  it("marks exactly one item current, never zero and never two", () => {
    const html = renderToString(<SegmentedTabs items={TABS} active="season" />);
    expect(html.match(/aria-current=/g)).toHaveLength(1);
  });

  it("marks nothing current when active matches no item", () => {
    const html = renderToString(<SegmentedTabs items={TABS} active="nope" />);
    expect(html).not.toContain("aria-current");
  });

  /**
   * The two roles this control plays, and the two correct answers for each.
   *
   * A labelled row is page navigation — `aria-current="page"` is the right
   * token and the landmark earns a `<nav>`. An unlabelled row filters the
   * page it is already on, where "page" would be a lie; it gets
   * `aria-current="true"` and no landmark, because a second unnamed `<nav>`
   * on the surface is noise for anyone listing landmarks.
   */
  it("is a labelled nav with aria-current=page when given a navLabel", () => {
    const html = renderToString(
      <SegmentedTabs items={TABS} active="week" navLabel="Train sections" />
    );
    expect(html).toContain('aria-label="Train sections"');
    expect(html).toContain("<nav");
    expect(html).toContain('aria-current="page"');
  });

  it("is a plain row with aria-current=true when not", () => {
    const html = renderToString(<SegmentedTabs items={PILLS} active={90} />);
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("aria-label");
    expect(html).toContain('aria-current="true"');
  });

  it("takes its layout from the caller, which is the part that differs", () => {
    const html = renderToString(
      <SegmentedTabs items={PILLS} active={30} className="mb-3 justify-end" />
    );
    expect(html).toMatch(/class="[^"]*mb-3[^"]*justify-end/);
  });

  it("sizes tabs and pills differently, and nothing else", () => {
    const tab = renderToString(<SegmentedTabs items={TABS} active="week" />);
    const pill = renderToString(
      <SegmentedTabs items={PILLS} active={30} size="pill" />
    );
    expect(tab).toContain("px-4 py-1.5");
    expect(pill).toContain("px-2.5 py-1");
  });

  /**
   * Gap is owned by the size rather than passed in. A caller-supplied `gap-1`
   * alongside a built-in `gap-1.5` puts both in the class list and lets
   * Tailwind's output order pick, which is not a decision either side made.
   */
  it("owns its gap, so a caller cannot half-override it", () => {
    const tab = renderToString(<SegmentedTabs items={TABS} active="week" />);
    const pill = renderToString(
      <SegmentedTabs items={PILLS} active={30} size="pill" />
    );
    expect(tab).toMatch(/class="flex gap-1\.5/);
    expect(pill).toMatch(/class="flex gap-1 /);
    expect(pill).not.toMatch(/gap-1\.5/);
  });

  /**
   * The load-bearing assertion, and the reason this module exists.
   *
   * Five hand-rolled tab rows drifted: `train/range-tabs` still painted its
   * active pill `bg-accent/20 text-accent` — a direct token translation of the
   * `bg-emerald-500/20` it shipped with in 00534a5 — while the other three had
   * moved to the surface treatment. Same control, two looks, and nothing made
   * them agree. One definition now serves every caller, so the treatment
   * cannot diverge again without this failing.
   */
  it("paints one treatment, whatever the size or role", () => {
    const variants = [
      renderToString(
        <SegmentedTabs items={TABS} active="week" navLabel="Train sections" />
      ),
      renderToString(<SegmentedTabs items={PILLS} active={30} size="pill" />),
    ];
    for (const html of variants) {
      expect(html).toContain("bg-surface-overlay text-ink-primary");
      expect(html).toContain("bg-surface-raised text-ink-muted");
      // The divergence that prompted this, in the form it took.
      expect(html).not.toMatch(/bg-accent\/20/);
      expect(html).not.toMatch(/text-accent/);
    }
  });

  /**
   * `{r}d` renders as `30<!-- -->d` — React inserts a boundary comment between
   * adjacent expression children, which split the range label across two text
   * nodes and forced both range-tabs tests to assert through the marker.
   * Labels arrive here as finished strings, so the artifact is gone rather
   * than worked around.
   */
  it("renders labels as one text node, no hydration boundary comment", () => {
    const html = renderToString(<SegmentedTabs items={PILLS} active={30} />);
    expect(html).toContain(">30d<");
    expect(html).not.toContain("<!-- -->");
  });

  it("uses the token type and ink scale, not ad-hoc alphas or arbitrary sizes", () => {
    const html = renderToString(
      <SegmentedTabs items={TABS} active="week" navLabel="Train sections" />
    );
    expect(html).toMatch(/text-label/);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/emerald/);
  });
});
