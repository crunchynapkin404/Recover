// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { IntervalsCard } from "./intervals-card";
import { LlmSettingsCard } from "./llm-settings-card";

/**
 * Two cards on ONE page, rendered together on purpose.
 *
 * Both post a form field called `apiKey`, and both used to carry `id="apiKey"`
 * to match. That is only a collision while intervals.icu is DISCONNECTED —
 * IntervalsCard renders its connect form in that state and nothing at all in
 * the other — which is precisely why it survived every capture: seed-demo.ts
 * connects all six connectors so the rest of Settings has something to render,
 * so no fixture had ever put both inputs in one document.
 * `settings-disconnected` (scripts/verify-surfaces.ts) is the fixture that
 * finally did, on its first run, 2026-09-04.
 *
 * THIS TEST IS THE GUARD, NOT THE CAPTURE. axe does report the collision, as
 * duplicate-id-aria — but in the "incomplete" bucket, which
 * scripts/lib/axe-report.ts classifies as INDETERMINATE and which never gates
 * the exit code (see its file header for why that split must not be merged).
 * So the capture photographs the defect without failing on it. A unit test
 * that fails is the only part of this that stops a recurrence.
 */
const llmSettings = {
  providerType: "anthropic" as const,
  model: "claude-opus-5",
  modelQuick: null,
  modelDeep: null,
  defaultMode: "quick" as const,
  baseUrl: null,
  hasKey: false,
};

/** Every `id="..."` in render order, duplicates included. */
function idsIn(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

describe("Settings ids are unique across cards", () => {
  it("does not collide when intervals.icu is disconnected", () => {
    const html =
      renderToString(<IntervalsCard connection={null} />) +
      renderToString(<LlmSettingsCard settings={llmSettings} />);

    const ids = idsIn(html);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it("keeps each API-key label pointing at its own input", () => {
    const intervals = renderToString(<IntervalsCard connection={null} />);
    const llm = renderToString(<LlmSettingsCard settings={llmSettings} />);

    expect(intervals).toContain('id="intervals-api-key"');
    expect(intervals).toContain('for="intervals-api-key"');
    expect(llm).toContain('id="llm-api-key"');
    expect(llm).toContain('for="llm-api-key"');

    // The point of the rename: neither card may reclaim the bare id, because
    // whichever rendered first would capture the other's label again.
    expect(intervals).not.toContain('id="apiKey"');
    expect(llm).not.toContain('id="apiKey"');
  });

  it("still posts both fields as apiKey — the ids moved, the names did not", () => {
    const intervals = renderToString(<IntervalsCard connection={null} />);
    const llm = renderToString(<LlmSettingsCard settings={llmSettings} />);

    expect(intervals).toContain('name="apiKey"');
    expect(llm).toContain('name="apiKey"');
  });
});
