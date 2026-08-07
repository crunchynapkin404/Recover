import type { PlannedWorkout } from "@/lib/training-plan";

type ZwoOk = {
  ok: true;
  fileName: string;
  content: string;
};

type ZwoErr = {
  ok: false;
  reason: "unsupported_sport";
  message: string;
};

export type ZwoResult = ZwoOk | ZwoErr;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function secs(mins: number): number {
  return Math.max(60, Math.round(mins * 60));
}

function sanitizeId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

type IntensityBand = "recovery" | "low" | "moderate" | "high";

function intensityBand(intensity: string): IntensityBand {
  const x = intensity.toUpperCase();
  if (x.includes("RECOVERY")) return "recovery";
  if (x.includes("Z4") || x.includes("Z5")) return "high";
  if (x.includes("Z3")) return "moderate";
  return "low";
}

function steadyPower(band: IntensityBand): string {
  switch (band) {
    case "recovery":
      return "0.55";
    case "moderate":
      return "0.80";
    case "high":
      return "0.90";
    default:
      return "0.68";
  }
}

function zwoWorkoutBody(session: PlannedWorkout): string {
  const total = secs(session.durationMins);
  const band = intensityBand(session.intensity);

  if (session.type === "Intervals") {
    const warm = Math.round(total * 0.15);
    let cool = Math.round(total * 0.15);
    const work = Math.max(60, total - warm - cool);
    const repeats = Math.max(2, Math.round(work / 300));
    const perRep = Math.max(30, Math.floor(work / repeats));
    const on = Math.max(20, Math.floor((perRep * 2) / 3));
    const off = Math.max(10, perRep - on);
    const used = repeats * (on + off);
    cool += work - used;
    const onPower = band === "moderate" ? "0.88" : "0.95";
    const offPower = band === "high" ? "0.58" : "0.55";
    return [
      `<Warmup Duration="${warm}" PowerLow="0.50" PowerHigh="0.62"/>`,
      `<IntervalsT Repeat="${repeats}" OnDuration="${on}" OffDuration="${off}" OnPower="${onPower}" OffPower="${offPower}"/>`,
      `<Cooldown Duration="${cool}" PowerLow="0.58" PowerHigh="0.45"/>`,
    ].join("\n      ");
  }

  if (session.type === "Tempo") {
    const warm = Math.round(total * 0.2);
    const cool = Math.round(total * 0.15);
    const steady = Math.max(60, total - warm - cool);
    const power = band === "high" ? "0.86" : band === "low" ? "0.76" : "0.82";
    return [
      `<Warmup Duration="${warm}" PowerLow="0.50" PowerHigh="0.65"/>`,
      `<SteadyState Duration="${steady}" Power="${power}"/>`,
      `<Cooldown Duration="${cool}" PowerLow="0.60" PowerHigh="0.45"/>`,
    ].join("\n      ");
  }

  if (session.type === "Recovery") {
    return `<SteadyState Duration="${total}" Power="${steadyPower("recovery")}"/>`;
  }

  if (session.type === "Brick") {
    return `<SteadyState Duration="${total}" Power="${steadyPower(band)}"/>`;
  }

  // Endurance + unknown fallback
  return `<SteadyState Duration="${total}" Power="${steadyPower(band)}"/>`;
}

export function sessionToZwo(
  session: PlannedWorkout,
  opts: { id: string }
): ZwoResult {
  if (session.sport !== "Bike") {
    return {
      ok: false,
      reason: "unsupported_sport",
      message: `Workout export v1 supports Bike sessions only. Got ${session.sport}.`,
    };
  }

  const id = sanitizeId(opts.id || `${session.type}-${session.durationMins}`);
  const name = `${session.type} - ${session.durationMins}min`;
  const body = zwoWorkoutBody(session);

  const content = `<workout_file>
  <author>Recover</author>
  <name>${escapeXml(name)}</name>
  <description>${escapeXml(session.description || name)}</description>
  <sportType>bike</sportType>
  <tags>
    <tag name="recover"/>
    <tag name="${escapeXml(session.type.toLowerCase())}"/>
  </tags>
  <workout>
      ${body}
  </workout>
</workout_file>
`;

  return {
    ok: true,
    fileName: `${id || "workout"}.zwo`,
    content,
  };
}
