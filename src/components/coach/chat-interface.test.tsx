import { readFileSync } from "node:fs";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ChartSpec } from "@/lib/tools/render-chart";

/**
 * Loose local shapes for a mocked message's `parts` — not imported from
 * `ai`/`@ai-sdk/react`, since that package is mocked below and there is no
 * real type left to hold this file to. Covers both branches
 * chat-interface.tsx's own render code recognises: a plain text part, and
 * the tool-invocation shape its `artifacts` filter reads (`result.artifact
 * === true`, then `result.spec` handed to ArtifactCard).
 */
type MockPart =
  | { type: "text"; text: string }
  | {
      type: "tool-invocation";
      toolCallId: string;
      result: { artifact: true; spec: ChartSpec };
    };

interface MockMessage {
  id: string;
  role: "user" | "assistant";
  parts: MockPart[];
}

/**
 * Mutable, module-level, and read fresh by the mock's `useChat` on every
 * call (M6, whole-branch review 2026-08-14). Before this it was a static
 * `{messages: [], status: "ready"}` literal baked into the `vi.mock` factory
 * itself, so no test in this 642-line component's file could ever render a
 * message, an artifact, the typing indicator, or the error banner —
 * `status` and `messages` could not vary, full stop. `vi.hoisted` so this
 * survives Vitest hoisting `vi.mock` above it regardless of source order.
 */
const chatState = vi.hoisted(() => ({
  messages: [] as MockMessage[],
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  error: undefined as Error | undefined,
}));

/** Clean slate before every test — one test's state must never leak into
 * the next, whatever order they run in. */
function resetChatState() {
  chatState.messages = [];
  chatState.status = "ready";
  chatState.error = undefined;
}

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatState.messages,
    sendMessage: vi.fn(),
    status: chatState.status,
    setMessages: vi.fn(),
    error: chatState.error,
  }),
}));

import { ChatInterface } from "./chat-interface";

const base = {
  configured: true,
  defaultMode: "deep" as const,
  threads: [],
  inboxItems: [],
  unread: 0,
};

beforeEach(resetChatState);

describe("ChatInterface", () => {
  it("shows the configure card when no LLM key is set", () => {
    const html = renderToString(<ChatInterface {...base} configured={false} />);
    expect(html).toContain("needs an LLM key");
    expect(html).toContain("Configure AI Coach");
    // The composer must not render at all in this state.
    expect(html).not.toContain("Message your coach");
  });

  it("localizes the suggestion chips to the pinned coach language", () => {
    const html = renderToString(<ChatInterface {...base} language="nl" />);
    expect(html).toContain("Hoe moet ik vandaag trainen?");
    expect(html).not.toContain("How should I train today?");
  });

  it("falls back to English for auto and for an unrecognized code", () => {
    for (const lang of ["auto", "kl"]) {
      const html = renderToString(<ChatInterface {...base} language={lang} />);
      expect(html).toContain("How should I train today?");
    }
  });

  it("hides the ghost toggle once a thread is active", () => {
    const withThread = renderToString(
      <ChatInterface {...base} initialThreadId="th1" />
    );
    const withoutThread = renderToString(<ChatInterface {...base} />);
    expect(withoutThread).toContain("Ghost chat — deletes after 24 hours");
    expect(withThread).not.toContain("Ghost chat — deletes after 24 hours");
  });

  it("renders a user + assistant message pair, including an artifact", () => {
    // One test covering both message-list rendering AND the artifact wiring
    // (M6, whole-branch review 2026-08-14): chat-interface.tsx's own
    // `artifacts` filter — matching `result.artifact === true` and handing
    // `result.spec` to ArtifactCard — had never run against a real message,
    // only ArtifactCard's own isolated test file had (artifact-card.test.tsx).
    const spec: ChartSpec = {
      type: "line",
      title: "CTL trend (mock)",
      series: [
        {
          label: "CTL",
          style: "solid",
          data: [
            { x: 1, y: 60 },
            { x: 2, y: 65 },
          ],
        },
      ],
    };
    chatState.messages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "How is my CTL trending?" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Your CTL has been climbing steadily." },
          {
            type: "tool-invocation",
            toolCallId: "call-1",
            result: { artifact: true, spec },
          },
        ],
      },
    ];
    const html = renderToString(<ChatInterface {...base} />);
    // Three markers, each naming something only this state renders: the
    // user bubble, the assistant bubble (through InlineMarkdown), and the
    // artifact card threaded through from the tool-invocation part.
    expect(html).toContain("How is my CTL trending?");
    expect(html).toContain("Your CTL has been climbing steadily.");
    expect(html).toContain("CTL trend (mock)");
  });

  it("shows the typing indicator while the assistant is streaming", () => {
    chatState.status = "streaming";
    const html = renderToString(<ChatInterface {...base} />);
    // The three pulsing dots are the only thing in this component carrying
    // this class — isLoading's `chat-bubble-ai` wrapper has no other text
    // marker of its own.
    expect(html).toContain("animate-pulse");
  });

  it("shows the error banner when the chat transport reports an error", () => {
    chatState.error = new Error("Simulated LLM outage for test coverage");
    const html = renderToString(<ChatInterface {...base} />);
    expect(html).toContain("Coach error:");
    expect(html).toContain("Simulated LLM outage for test coverage");
  });
});

describe("ChatInterface source invariants", () => {
  it("does not stamp messages with the render time", () => {
    // The old markup called new Date() inside messages.map, so every bubble
    // showed the clock at render. Nothing in the client transport carries a
    // per-message time, so the honest rendering is none at all.
    const src = readFileSync(
      new URL("./chat-interface.tsx", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/new Date\(\)\.toLocaleTimeString/);
  });
});
