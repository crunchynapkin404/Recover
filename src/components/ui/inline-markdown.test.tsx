import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { InlineMarkdown } from "./inline-markdown";

describe("InlineMarkdown", () => {
  it("renders bold as an element rather than printing asterisks", () => {
    const html = renderToString(
      <InlineMarkdown text="**Amber-band status** — manage carefully." />
    );
    expect(html).toContain("<strong");
    expect(html).toContain("Amber-band status");
    expect(html).not.toContain("**");
  });

  it("renders italics and inline code", () => {
    const html = renderToString(
      <InlineMarkdown text="hold *steady* at your `ftp`" />
    );
    expect(html).toContain("<em");
    expect(html).toContain("steady");
    expect(html).toContain("<code");
    expect(html).toContain("ftp");
  });

  it("leaves arithmetic alone — 2×20 is not emphasis", () => {
    const html = renderToString(<InlineMarkdown text="2×20 @ 88–93% FTP" />);
    expect(html).not.toContain("<em");
    expect(html).toContain("2×20 @ 88–93% FTP");
  });

  it("does not treat a mid-word asterisk as italics", () => {
    const html = renderToString(<InlineMarkdown text="load*2 is not italic" />);
    expect(html).not.toContain("<em");
  });

  it("keeps plain text untouched", () => {
    const html = renderToString(<InlineMarkdown text="CTL 51 → 58" />);
    expect(html).toContain("CTL 51 → 58");
  });
});
