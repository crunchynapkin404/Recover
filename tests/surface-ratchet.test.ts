import { describe, expect, it } from "vitest";
import { checkRatchet } from "../scripts/lib/surface-ratchet";

const totals = (confirmedNodes: number, indeterminateNodes = 99) => ({
  confirmedRuleRows: 0,
  confirmedNodes,
  indeterminateRuleRows: 0,
  indeterminateNodes,
});

describe("checkRatchet", () => {
  it("passes when the count equals the ceiling", () => {
    expect(checkRatchet(totals(10), { confirmedNodes: 10 }, 0).ok).toBe(true);
  });

  it("fails when the count rises above the ceiling", () => {
    const r = checkRatchet(totals(11), { confirmedNodes: 10 }, 0);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/11/);
    expect(r.message).toMatch(/10/);
  });

  it("passes a rise that stays inside the slack", () => {
    expect(checkRatchet(totals(12), { confirmedNodes: 10 }, 5).ok).toBe(true);
  });

  it("passes when the count drops, and asks to be re-pinned", () => {
    const r = checkRatchet(totals(4), { confirmedNodes: 10 }, 0);
    expect(r.ok).toBe(true);
    expect(r.shouldRepin).toBe(true);
  });

  // The four gradient surfaces can never resolve, so gating this makes zero
  // permanently unreachable. It is reported and never gates.
  it("ignores indeterminate entirely", () => {
    const r = checkRatchet(totals(0, 100000), { confirmedNodes: 0 }, 0);
    expect(r.ok).toBe(true);
  });

  // The seed value in surface-ceilings.json. Nothing may pass against a
  // ceiling nobody measured, so -1 must fail even on a perfectly clean run.
  it("fails against the unmeasured seed ceiling", () => {
    expect(checkRatchet(totals(0), { confirmedNodes: -1 }, 0).ok).toBe(false);
  });
});
