import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { RangeTabs } from "./range-tabs";
import type { LogHref } from "@/lib/log-href";

const href: LogHref = (over) => `/train?range=${over.range ?? 90}`;

describe("RangeTabs", () => {
  it("renders the four ranges and marks the active one", () => {
    const html = renderToString(
      <RangeTabs active={90} view="training" href={href} />
    );
    // React 19 inserts <!-- --> between adjacent JSX expression children —
    // `{r}d` renders as `30<!-- -->d`, not the literal substring "30d".
    // src/components/today/week-row.test.tsx is the house convention for
    // asserting through the marker; adapt the test to it rather than
    // reshaping the component to dodge the artifact (see range-tabs.tsx).
    // The optional group still requires the digits and the "d" on either
    // side, so a missing range or a missing "d" still fails this.
    expect(html).toMatch(/30(<!--\s*-->)?d/);
    expect(html).toMatch(/90(<!--\s*-->)?d/);
    expect(html).toMatch(/180(<!--\s*-->)?d/);
    expect(html).toMatch(/365(<!--\s*-->)?d/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("uses the token type and ink scale, not ad-hoc white alphas", () => {
    const html = renderToString(
      <RangeTabs active={90} view="training" href={href} />
    );
    expect(html).toMatch(/text-label/);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/emerald/);
  });
});
