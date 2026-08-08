import { expect, test } from "vitest";
import { isWithinQuietHours } from "./push";

test("isWithinQuietHours handles a normal daytime window", () => {
  expect(isWithinQuietHours(22, 21, 23)).toBe(true);
  expect(isWithinQuietHours(20, 21, 23)).toBe(false);
});

test("isWithinQuietHours handles a window that wraps midnight", () => {
  expect(isWithinQuietHours(2, 22, 6)).toBe(true);
  expect(isWithinQuietHours(14, 22, 6)).toBe(false);
});

test("isWithinQuietHours treats unset bounds as disabled", () => {
  expect(isWithinQuietHours(8, null, 6)).toBe(false);
  expect(isWithinQuietHours(8, 22, null)).toBe(false);
});