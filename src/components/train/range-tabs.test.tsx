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
    expect(html).toContain("30d");
    expect(html).toContain("90d");
    expect(html).toContain("180d");
    expect(html).toContain("365d");
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
