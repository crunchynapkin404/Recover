"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  storeDebriefAnswer,
  storeDebriefSkip,
  type DebriefInput,
  type DebriefResult,
} from "@/lib/debrief/answer";
import { generateRideReview } from "@/lib/debrief/ride-review";
import { markDayDoneForActivity } from "@/lib/week-plan/complete-from-activity";

export async function submitDebrief(
  activityId: string,
  input: DebriefInput
): Promise<DebriefResult> {
  const user = await requireUser();
  const res = await storeDebriefAnswer(user.id, activityId, input);
  if (res.ok) {
    // ONE STEP: "yes, this was my planned session" completes the day here,
    // in the same submit as the RPE and the note, rather than sending the
    // athlete to a second button on Today.
    //
    // AFTER the answers are stored and deliberately not inside the same
    // transaction. markDayDone refuses a rest day, a race day, an already
    // completed or missed day, and a day with no open week — and none of
    // those refusals should cost the athlete the RPE, feel and note they
    // just typed. The status is the cheaper half to lose: it is one tap on
    // Today, and the answers are not recoverable at all.
    //
    // Only `true`. `false` and `null` leave the day exactly as it is —
    // null means unanswered, which is not "no".
    if (input.wasPlanned === true) {
      await markDayDoneForActivity(user.id, activityId);
    }
    // Review inline for immediate feedback; a failure here is retried by the
    // next lifecycle tick (generateRideReview owns the attempts cap).
    await generateRideReview(activityId);
    revalidatePath("/");
    revalidatePath(`/activity/${activityId}`);
  }
  return res;
}

export async function skipDebrief(activityId: string): Promise<DebriefResult> {
  const user = await requireUser();
  const res = await storeDebriefSkip(user.id, activityId);
  if (res.ok) {
    await generateRideReview(activityId);
    revalidatePath("/");
    revalidatePath(`/activity/${activityId}`);
  }
  return res;
}
