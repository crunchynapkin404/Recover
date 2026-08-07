import { describe, expect, it } from "vitest";
import { resolvePlanStyle } from "./resolve";

describe("resolvePlanStyle", () => {
  it("defaults to balanced when missing", () => {
    expect(resolvePlanStyle(undefined)).toBe("balanced");
  });

  it("defaults to balanced when invalid", () => {
    expect(resolvePlanStyle("weird" as never)).toBe("balanced");
  });

  it("keeps block_lite when valid", () => {
    expect(resolvePlanStyle("block_lite")).toBe("block_lite");
  });
});
