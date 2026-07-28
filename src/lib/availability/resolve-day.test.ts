// src/lib/availability/resolve-day.test.ts
import { describe, expect, it } from "vitest";
import { resolveDay } from "./resolve-day";
import type { AvailabilityBlock } from "./types";

const b = (mins: number): AvailabilityBlock => ({
  start: null,
  end: null,
  mins,
  energy: "normal",
  sports: null,
});

describe("resolveDay", () => {
  it("uses the weekday default when there is no override", () => {
    expect(resolveDay([b(180)], null)).toEqual([b(180)]);
  });

  it("lets an override win outright", () => {
    expect(resolveDay([b(180)], [b(60)])).toEqual([b(60)]);
  });

  it("treats an empty override as unavailable, not as absent", () => {
    expect(resolveDay([b(180)], [])).toEqual([]);
  });

  it("does not merge: the override replaces the whole day", () => {
    expect(resolveDay([b(60), b(60)], [b(30)])).toEqual([b(30)]);
  });

  // The JOIN rule, stated as a test: raising every Wednesday to 3h must not
  // touch the one Wednesday already pinned to 1h.
  it("keeps a pinned date when the weekday default is raised later", () => {
    const pinned = [b(60)];
    const before = resolveDay([b(60)], pinned);
    const after = resolveDay([b(180)], pinned);
    expect(before).toEqual(after);
    expect(after).toEqual([b(60)]);
  });

  it("returns an empty day when neither default nor override exists", () => {
    expect(resolveDay([], null)).toEqual([]);
  });
});
