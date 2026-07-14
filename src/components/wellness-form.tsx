"use client";

import { useActionState } from "react";
import { logWellness, type ActionResult } from "@/app/wellness/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
}

const subjectiveFields = [
  { name: "energy", label: "Energy (1–10)" },
  { name: "soreness", label: "Soreness (1–10)" },
  { name: "stress", label: "Stress (1–10)" },
] as const;

export function WellnessForm() {
  const [state, action, pending] = useActionState<
    ActionResult | null,
    FormData
  >(logWellness, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily check-in</CardTitle>
        <CardDescription>
          Everything is optional — log what you have. Fields you leave empty
          keep their synced values. Readiness recomputes on save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              defaultValue={todayLocal()}
              max={todayLocal()}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="sleepHours">Sleep (hours)</Label>
              <Input
                id="sleepHours"
                name="sleepHours"
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0"
                max="24"
                placeholder="7.5"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="weightKg">Weight (kg)</Label>
              <Input
                id="weightKg"
                name="weightKg"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="20"
                max="300"
                placeholder="71.5"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {subjectiveFields.map((f) => (
              <div key={f.name} className="grid gap-2">
                <Label htmlFor={f.name}>{f.label}</Label>
                <Input
                  id={f.name}
                  name={f.name}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="10"
                  placeholder="5"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="hrvMs">HRV rMSSD (ms)</Label>
              <Input
                id="hrvMs"
                name="hrvMs"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="1"
                max="300"
                placeholder="Only if measured manually"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="restingHr">Resting HR (bpm)</Label>
              <Input
                id="restingHr"
                name="restingHr"
                type="number"
                inputMode="numeric"
                min="20"
                max="120"
                placeholder="Only if measured manually"
              />
            </div>
          </div>

          {state && (
            <p
              role="status"
              className={`text-sm ${state.ok ? "text-muted-foreground" : "text-destructive"}`}
            >
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save check-in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
