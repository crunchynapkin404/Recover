"use client";

import { useTransition } from "react";
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
    <button
      type="button"
      aria-label={`Delete ${activityName}`}
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete ${activityName}? This can't be undone.`)) {
          startTransition(async () => {
            await deleteActivity(activityId);
            router.push("/train?tab=history");
          });
        }
      }}
      className="shrink-0 rounded-full p-2 text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
    >
      <Trash2 aria-hidden className="size-4" />
    </button>
  );
}
