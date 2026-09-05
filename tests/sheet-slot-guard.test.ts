// tests/sheet-slot-guard.test.ts — the activity page's sheet slot.
//
// AppShell renders `overlay` as a SIBLING of `[data-app-background]`, and
// BottomSheet marks that element `inert` while it is open. A sheet handed to
// AppShell through its CHILDREN therefore sits inside the subtree it
// suppresses — and `inert` covers a whole subtree, so the sheet disables its
// own controls. `/activity/[id]` did exactly that to the post-ride debrief
// from v0.125.0 (the release that moved `inert` into BottomSheet) until this
// guard: RPE, feel, note, Save, Skip and the close scrim were all dead, and
// the sheet could not even be dismissed. Two earlier bugs in this family
// killed whole pages the same way — Today's always-truthy `<SheetHost/>` and
// Coach's `lg:hidden` history panel.
//
// bottom-sheet.tsx now refuses to inert an ancestor of its own panel, which
// is the safety net that makes the failure impossible to reach. This is the
// composition rule, kept to the one page whose sheet is built inline: Train
// and Today build theirs in a helper and pass the result to `overlay`, a
// data flow no lexical check can follow.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = join(
  __dirname,
  "..",
  "src",
  "app",
  "activity",
  "[id]",
  "page.tsx"
);

/** Text of the `overlay={...}` prop, brace-matched — a regex cannot balance
 *  the nested JSX such a prop holds. */
function overlayProp(text: string): string {
  const m = /overlay=\{/.exec(text);
  if (!m) return "";
  let depth = 1;
  let i = m.index + m[0].length;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
  }
  return text.slice(m.index, i);
}

describe("the activity page's debrief sheet", () => {
  const text = readFileSync(PAGE, "utf8");

  it("is rendered at all", () => {
    // Without this the assertions below pass vacuously if the component is
    // renamed or the page moves, and the rule stops being enforced.
    expect(text).toMatch(/<ActivityDebriefSheet[\s/>]/);
  });

  it("reaches AppShell through `overlay`, never through children", () => {
    const overlay = overlayProp(text);
    expect(
      /<ActivityDebriefSheet[\s/>]/.test(overlay),
      "<ActivityDebriefSheet/> must be passed to AppShell's `overlay` prop. " +
        "Rendered among the page's children it lands inside " +
        "[data-app-background], which BottomSheet marks `inert` on mount — " +
        "the sheet would disable its own controls."
    ).toBe(true);
    // Exactly one usage: a second one among the children would be inside the
    // inert subtree even though the overlay copy satisfies the check above.
    expect(text.match(/<ActivityDebriefSheet[\s/>]/g)).toHaveLength(1);
  });
});
