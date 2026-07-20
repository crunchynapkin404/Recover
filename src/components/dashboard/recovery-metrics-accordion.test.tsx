// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { RecoveryMetricsAccordion } from "./recovery-metrics-accordion";

const emptyTile = (label: string) => ({
  label,
  value: "—",
  unit: "",
  avg7d: null,
  trend: "flat" as const,
  trendGood: true,
  sparkPath: "",
  sparkColor: "transparent",
});

const filledTiles = [
  {
    label: "HRV",
    value: "52",
    unit: "ms",
    avg7d: "50ms",
    trend: "up" as const,
    trendGood: true,
    sparkPath: "M0 0 L1 1",
    sparkColor: "#10b981",
  },
];

/** Mounts, clicks the trigger open, and returns the live container. */
function renderOpen(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  const trigger = container.querySelector("button");
  if (!trigger) throw new Error("trigger button not found");
  act(() => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return container;
}

describe("RecoveryMetricsAccordion", () => {
  it("defaults to closed and shows the tile count badge", () => {
    const html = renderToString(
      <RecoveryMetricsAccordion
        tiles={[emptyTile("HRV")]}
        sleep={null}
        stages={null}
        quality={null}
        battery={{ current: null, points: [] }}
      />
    );
    expect(html).not.toContain("data-panel-open");
    expect(html).toContain(">1<");
    expect(html).toContain("Recovery Metrics");
  });

  it("shows the empty state when there is no vitals, sleep, or stage data", () => {
    const container = renderOpen(
      <RecoveryMetricsAccordion
        tiles={[emptyTile("HRV"), emptyTile("Resting HR")]}
        sleep={null}
        stages={null}
        quality={null}
        battery={{ current: null, points: [] }}
      />
    );
    expect(container.innerHTML).toContain("No recovery data yet");
  });

  it("hides the empty state once any tile has real data", () => {
    const container = renderOpen(
      <RecoveryMetricsAccordion
        tiles={filledTiles}
        sleep={null}
        stages={null}
        quality={null}
        battery={{ current: null, points: [] }}
      />
    );
    expect(container.innerHTML).not.toContain("No recovery data yet");
  });

  it("renders SleepCard, SleepStagesCard, and SleepQualityCard only when their data exists", () => {
    const container = renderOpen(
      <RecoveryMetricsAccordion
        tiles={filledTiles}
        sleep={{
          score: 82,
          duration: "7h 30m",
          debtSecs: 0,
          bedtimeAdvice: null,
          wakeTimeSet: false,
        }}
        stages={{
          deepSecs: 3600,
          remSecs: 3600,
          lightSecs: 7200,
          awakeSecs: 600,
          fractions: { deep: 0.25, rem: 0.25, light: 0.45, awake: 0.05 },
          bedWindow: null,
        }}
        quality={{
          consistency: { score: 88, sampleNights: 14 },
          chronotype: null,
        }}
        battery={{ current: null, points: [] }}
      />
    );
    expect(container.innerHTML).toContain("Last Night");
    expect(container.innerHTML).toContain("Sleep Stages");
    expect(container.innerHTML).toContain("Sleep Quality");
  });

  it("omits SleepCard, SleepStagesCard, and SleepQualityCard when their data is null", () => {
    const container = renderOpen(
      <RecoveryMetricsAccordion
        tiles={filledTiles}
        sleep={null}
        stages={null}
        quality={null}
        battery={{ current: null, points: [] }}
      />
    );
    expect(container.innerHTML).not.toContain("Last Night");
    expect(container.innerHTML).not.toContain("Sleep Stages");
    expect(container.innerHTML).not.toContain("Sleep Quality");
  });

  it("always renders the energy curve card, data or not", () => {
    const container = renderOpen(
      <RecoveryMetricsAccordion
        tiles={[emptyTile("HRV")]}
        sleep={null}
        stages={null}
        quality={null}
        battery={{ current: null, points: [] }}
      />
    );
    expect(container.innerHTML).toContain("Estimated Energy");
  });
});
