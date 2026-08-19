// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

/**
 * The hydration contract for browser feature detection.
 *
 * `useDictation` hides the mic entirely where the Web Speech API is missing —
 * `checkin-sheet.tsx:238`, `debrief-sheet.tsx:147` and
 * `chat-interface.tsx:626` all render the button behind `dictation.supported`.
 * That is the right behaviour and not the bug.
 *
 * The bug was WHEN the answer arrives. `supported` was derived from a
 * module-scope constant read from `typeof window`, so the server said false
 * and the client's FIRST render said true — and React threw
 * "Hydration failed because the server rendered HTML didn't match the client"
 * on /coach, /coach?history=1 and /?sheet=checkin, discarding and
 * regenerating the tree. React's own error names this as its first listed
 * cause: a server/client branch on `typeof window`.
 *
 * `renderToString` runs a component body once and runs no effects, which is
 * exactly the render that has to agree with the server's. So this asserts the
 * hook reports UNSUPPORTED there even when the API is present — the mic may
 * only appear after mount.
 */
describe("useDictation — the first render must match the server", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>)
      .webkitSpeechRecognition;
  });

  async function harnessHtml(): Promise<string> {
    const { useDictation } = await import("./use-dictation");
    function Harness() {
      const d = useDictation(() => {});
      return <span>{d.supported ? "mic" : "no-mic"}</span>;
    }
    return renderToString(<Harness />);
  }

  it("reports unsupported on the first render even where the API exists", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      class {};
    expect(await harnessHtml()).toContain("no-mic");
  });

  it("also reports unsupported where the API is genuinely absent", async () => {
    expect(await harnessHtml()).toContain("no-mic");
  });

  it("still exposes dictationSupported() for imperative callers", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
      class {};
    const { dictationSupported } = await import("./use-dictation");
    expect(dictationSupported()).toBe(true);
  });
});
