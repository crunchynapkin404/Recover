"use client";

import { useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteActivity } from "@/app/activity/actions";

export function DeleteActivityButton({
  activityId,
  activityName,
}: {
  activityId: string;
  activityName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <PendingButton
      type="button"
      aria-label={`Delete ${activityName}`}
      pending={pending}
      // An icon-only button cannot grow an ellipsis, so the mark stays put and
      // the win here is `aria-busy` alongside the aria-label that already
      // names the action. The types require this to be explicit rather than
      // letting the button silently say nothing.
      pendingLabel={<Trash2 aria-hidden className="size-4" />}
      onClick={() => {
        if (confirm(`Delete ${activityName}? This can't be undone.`)) {
          startTransition(async () => {
            await deleteActivity(activityId);
            router.push("/train?tab=history");
          });
        }
      }}
      className="shrink-0 rounded-full p-2 text-ink-muted transition-colors hover:bg-destructive-tint hover:text-destructive-ink disabled:opacity-50"
    >
      <Trash2 aria-hidden className="size-4" />
    </PendingButton>
  );
}
