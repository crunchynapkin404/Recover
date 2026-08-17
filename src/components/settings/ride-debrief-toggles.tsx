"use client";

import { useState, useTransition } from "react";
import {
  setRideDebriefs,
  setDebriefPush,
} from "@/app/settings/debrief-actions";

export function RideDebriefToggles({
  rideDebriefsEnabled,
  debriefPushEnabled,
}: {
  rideDebriefsEnabled: boolean;
  debriefPushEnabled: boolean;
}) {
  const [loop, setLoop] = useState(rideDebriefsEnabled);
  const [push, setPush] = useState(debriefPushEnabled);
  const [, startTransition] = useTransition();

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro">Ride debriefs</h3>
      <p className="mt-2 text-caption text-ink-muted">
        After a ride syncs, the coach asks how it went and writes a review.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex items-center justify-between py-3 text-caption font-medium">
          <span className="flex flex-col">
            <span>Ride debriefs</span>
            <span className="text-label font-bold uppercase text-ink-muted">
              Ask how the ride went after it syncs
            </span>
          </span>
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => {
              const next = e.target.checked;
              setLoop(next);
              startTransition(() => setRideDebriefs(next));
            }}
            className="h-5 w-5 accent-emerald-500"
            aria-label="Ride debriefs"
          />
        </label>

        <label className="flex items-center justify-between border-t border-hairline py-3 text-caption font-medium has-[:disabled]:opacity-40">
          <span className="flex flex-col">
            <span>Debrief push</span>
            <span className="text-label font-bold uppercase text-ink-muted">
              {loop
                ? "Notify when a ride is ready to debrief"
                : "Turn ride debriefs on first"}
            </span>
          </span>
          <input
            type="checkbox"
            checked={push && loop}
            disabled={!loop}
            onChange={(e) => {
              const next = e.target.checked;
              setPush(next);
              startTransition(() => setDebriefPush(next));
            }}
            className="h-5 w-5 accent-emerald-500 disabled:opacity-40"
            aria-label="Debrief push"
          />
        </label>
      </div>
    </section>
  );
}
