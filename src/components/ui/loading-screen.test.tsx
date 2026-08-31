import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { LoadingScreen } from "./loading-screen";
import { Skeleton } from "./skeleton";

describe("LoadingScreen", () => {
  it("exposes the wait as a live status, not just an animation", () => {
    const html = renderToString(
      <LoadingScreen label="Train">
        <Skeleton className="h-8" />
      </LoadingScreen>
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading Train");
    // Visually hidden, not visually absent: the label must not push the
    // skeletons down the page.
    expect(html).toContain("sr-only");
  });

  it("does not announce the skeletons themselves", () => {
    // The skeletons are decoration. If they were not aria-hidden a screen
    // reader would walk a pile of empty divs inside the live region, which is
    // noisier than the silence this replaced.
    const html = renderToString(
      <LoadingScreen label="Body">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </LoadingScreen>
    );
    const skeletons = html.match(/data-slot="skeleton"/g) ?? [];
    const hidden = html.match(/aria-hidden="true"/g) ?? [];
    expect(skeletons).toHaveLength(2);
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });

  it("says a plain 'Loading…' when no surface is named", () => {
    // src/app/loading.tsx is the ROOT segment's boundary, so it stands in for
    // every route whose own boundary has not resolved yet — a hard load of
    // /train paints it first. It must not name a surface, or it announces the
    // wrong one. This shipped briefly saying "Loading your day…" on /train
    // and /admin, and only a screenshot of the real loading screen caught it.
    const html = renderToString(
      <LoadingScreen>
        <Skeleton className="h-8" />
      </LoadingScreen>
    );
    expect(html).toContain("Loading…");
    expect(html).not.toContain("Loading your day");
  });
});
