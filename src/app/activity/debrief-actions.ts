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

export async function submitDebrief(
  activityId: string,
  input: DebriefInput
): Promise<DebriefResult> {
  const user = await requireUser();
  const res = await storeDebriefAnswer(user.id, activityId, input);
  if (res.ok) {
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
