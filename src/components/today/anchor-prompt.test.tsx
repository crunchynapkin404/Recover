// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AnchorPrompt } from "./anchor-prompt";

// The server action is a module boundary; this file tests what renders.
vi.mock("@/app/settings/body-actions", () => ({
  dismissAnchorPrompt: vi.fn(),
}));

describe("AnchorPrompt", () => {
  it("renders nothing when no anchor is missing", () => {
    expect(
      renderToString(
        <AnchorPrompt missing={{ ftp: false, pace: false, dismissed: false }} />
      )
    ).toBe("");
  });

  // Dismiss removes the nag, not the information — the settings badge and
  // every "Set it" link keep working. This block is the only thing silenced.
  it("renders nothing once dismissed, even with an anchor still missing", () => {
    expect(
      renderToString(
        <AnchorPrompt missing={{ ftp: false, pace: true, dismissed: true }} />
      )
    ).toBe("");
  });

  it("asks a runner for a pace, links to the field, and never mentions FTP", () => {
    const html = renderToString(
      <AnchorPrompt missing={{ ftp: false, pace: true, dismissed: false }} />
    );
    expect(html).toContain("threshold pace");
    expect(html).toContain("/settings?open=baselines#threshold-pace");
    expect(html).not.toContain("FTP");
  });

  it("asks a cyclist for an FTP, links to that field, and never mentions pace", () => {
    const html = renderToString(
      <AnchorPrompt missing={{ ftp: true, pace: false, dismissed: false }} />
    );
    expect(html).toContain("FTP");
    expect(html).toContain("/settings?open=baselines#ftp-outdoor");
    expect(html).not.toContain("threshold pace");
  });

  // Two stacked prompts on Today is a nag rather than a question.
  it("asks a duathlete for both in one block, with one dismiss", () => {
    const html = renderToString(
      <AnchorPrompt missing={{ ftp: true, pace: true, dismissed: false }} />
    );
    expect(html).toContain("FTP");
    expect(html).toContain("threshold pace");
    expect(html.match(/Not now/g) ?? []).toHaveLength(1);
  });
});
