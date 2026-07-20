import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { Activity } from "lucide-react";
import { VitalsGrid } from "@/components/dashboard/vitals-grid";
import { SleepCard } from "@/components/dashboard/sleep-card";
import { SleepStagesCard } from "@/components/dashboard/sleep-stages-card";
import { SleepQualityCard } from "@/components/dashboard/sleep-quality-card";
import { BodyBatteryCurve } from "@/components/dashboard/body-battery";
import type { BatteryPoint } from "@/lib/body-battery";

interface VitalTile {
  label: string;
  value: string;
  unit: string;
  avg7d: string | null;
  trend: "up" | "down" | "flat";
  trendGood: boolean;
  sparkPath: string;
  sparkColor: string;
}

interface Props {
  tiles: VitalTile[];
  sleep: {
    score: number | null;
    duration: string;
    debtSecs: number | null;
    bedtimeAdvice: string | null;
    wakeTimeSet: boolean;
  } | null;
  stages: {
    deepSecs: number;
    remSecs: number;
    lightSecs: number;
    awakeSecs: number;
    fractions: { deep: number; rem: number; light: number; awake: number };
    bedWindow: { start: string; end: string } | null;
  } | null;
  quality: {
    consistency: { score: number; sampleNights: number } | null;
    chronotype: { midpointHhMm: string; socialJetlagMins: number } | null;
  } | null;
  battery: { current: number | null; points: BatteryPoint[] };
}

export function RecoveryMetricsAccordion({
  tiles,
  sleep,
  stages,
  quality,
  battery,
}: Props) {
  const hasAnyData =
    tiles.some((t) => t.value !== "—") || sleep != null || stages != null;

  return (
    <Collapsible>
      <CollapsibleTrigger
        badge={
          <span className="text-[9px] font-bold uppercase text-white/40">
            {tiles.length}
          </span>
        }
      >
        <Activity aria-hidden className="size-[18px] text-emerald-400" />
        <span className="text-xs font-bold uppercase tracking-widest text-white/80">
          Recovery Metrics
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="space-y-6 p-5 pt-4">
          {!hasAnyData && (
            <EmptyState
              icon={Activity}
              message="No recovery data yet — connect a device or log a morning check-in."
            />
          )}
          <VitalsGrid tiles={tiles} />
          {sleep && <SleepCard {...sleep} />}
          {stages && <SleepStagesCard {...stages} />}
          {quality && (quality.consistency || quality.chronotype) && (
            <SleepQualityCard {...quality} />
          )}
          <BodyBatteryCurve current={battery.current} points={battery.points} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
