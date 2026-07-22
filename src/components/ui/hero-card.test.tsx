import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { HeroCard } from "./hero-card";

describe("HeroCard", () => {
  it("renders children inside a bounded glass container", () => {
    const html = renderToString(
      <HeroCard>
        <span>ring</span>
      </HeroCard>
    );
    expect(html).toContain("ring");
    expect(html).toContain("glass");
    expect(html).toContain("rounded-[2rem]");
    expect(html).toContain("glass-no-hover");
  });

  it("applies the emerald glow shadow by default", () => {
    const html = renderToString(<HeroCard>x</HeroCard>);
    expect(html).toContain("rgba(16,185,129,0.25)");
  });

  it("omits the glow shadow when glow is false", () => {
    const html = renderToString(<HeroCard glow={false}>x</HeroCard>);
    expect(html).not.toContain("rgba(16,185,129,0.25)");
  });
});
