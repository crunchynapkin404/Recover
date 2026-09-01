import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getOpenWeekPlan } from "@/lib/week-plan/service";
import { workoutForDay } from "@/lib/interval/for-day";
import { renderZwo } from "@/lib/interval/render-zwo";

export const dynamic = "force-dynamic";

/** `YYYY-MM-DD`, and nothing else — the date is a lookup key, not free text. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A day's structured workout as a Zwift `.zwo` file.
 *
 * DERIVES EVERYTHING AND STORES NOTHING. The file is a pure function of the
 * planned day, so downloading twice gives the same bytes and downloading never
 * changes the plan. Pinning belongs to the intervals.icu write, where the
 * workout leaves Recover and lands on a device — a download the athlete can
 * repeat is not that moment.
 *
 * A day with no matching workout is a 404, deliberately: the athlete's day
 * genuinely has no structured session, and inventing an empty file would be a
 * worse answer than saying so.
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const idx = Number(url.searchParams.get("i") ?? "0");
  if (!YMD.test(date)) return new Response("Bad date", { status: 400 });
  if (!Number.isInteger(idx) || idx < 0) {
    return new Response("Bad session index", { status: 400 });
  }

  const week = await getOpenWeekPlan(session.user.id);
  const day = week?.days.find((d) => d.date === date);
  const planned = day?.workouts[idx];
  if (!planned) return new Response("No such session", { status: 404 });

  const structured = workoutForDay(planned, date);
  if (!structured) {
    return new Response("No structured workout for this session", {
      status: 404,
    });
  }

  const xml = renderZwo({ ...structured.workout, blocks: structured.blocks });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${structured.workout.id}-${date}.zwo"`,
    },
  });
}
