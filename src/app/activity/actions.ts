"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { deleteActivity as deleteActivityForUser } from "@/lib/activity-write";

export async function deleteActivity(activityId: string): Promise<boolean> {
  const user = await requireUser();
  const removed = await deleteActivityForUser(user.id, activityId);
  if (removed) {
    revalidatePath("/train");
    revalidatePath("/");
  }
  return removed;
}
