import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    setMessages: vi.fn(),
    error: undefined,
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
