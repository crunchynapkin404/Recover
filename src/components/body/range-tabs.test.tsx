import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { RangeTabs } from "./range-tabs";
import { RANGES } from "@/lib/log-href";

const href = (over: { range?: number }) => `/body?range=${over.range}`;

describe("RangeTabs", () => {
  it("offers every range and marks the active one", () => {
    const html = renderToString(
      <RangeTabs active={90} ranges={RANGES} href={href} />
    );
    // React 19 splits `{r}d` into two sibling children, rendered with an
    // HTML comment between them — match across that artifact, not the text.
    for (const r of RANGES)
      expect(html).toMatch(new RegExp(`${r}(<!-- -->)?d`));
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("holds the 12px floor — these were 10px, the smallest pills on Body", () => {
    const html = renderToString(
      <RangeTabs active={30} ranges={RANGES} href={href} />
    );
    expect(html).toContain("text-label");
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toContain("text-white/");
  });
});
