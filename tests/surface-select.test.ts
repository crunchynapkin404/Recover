import { describe, expect, it } from "vitest";
import { selectSurfaces } from "../scripts/lib/surface-select";

const ALL = ["today", "today-evening", "train", "admin"];

describe("selectSurfaces", () => {
  it("returns everything when neither filter is given", () => {
    expect(selectSurfaces(ALL, {})).toEqual(ALL);
  });

  it("keeps only the named surfaces, in the original order", () => {
    expect(selectSurfaces(ALL, { only: ["train", "today"] })).toEqual([
      "today",
      "train",
    ]);
  });

  it("drops the named surfaces", () => {
    expect(selectSurfaces(ALL, { except: ["today", "today-evening"] })).toEqual(
      ["train", "admin"]
    );
  });

  // A typo that silently captures nothing is the exact silent-pass failure
  // this repository keeps rediscovering. Refuse it loudly instead.
  it("throws on an unknown name in only", () => {
    expect(() => selectSurfaces(ALL, { only: ["trian"] })).toThrow(/trian/);
  });

  it("throws on an unknown name in except", () => {
    expect(() => selectSurfaces(ALL, { except: ["nope"] })).toThrow(/nope/);
  });

  it("throws when both filters are given", () => {
    expect(() =>
      selectSurfaces(ALL, { only: ["train"], except: ["admin"] })
    ).toThrow(/both/i);
  });

  it("throws when the selection is empty", () => {
    expect(() => selectSurfaces(ALL, { except: ALL })).toThrow(/no surfaces/i);
  });
});
