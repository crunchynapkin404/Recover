import { Fragment } from "react";

/**
 * The small slice of markdown the coach actually writes: **bold**, *italic*
 * and `code`, inline. Everything else — paragraphs, line breaks — is left to
 * the caller's `whitespace-pre-wrap`.
 *
 * This exists because the LLM emits markdown and the app was rendering the
 * asterisks verbatim. It deliberately does not parse block markdown: a full
 * parser would be a dependency and a sanitisation surface for what is, in
 * practice, emphasis.
 *
 * `strong` uses `text-foreground`, not `text-white`. It was `text-white` from
 * when this app was dark-only, and stayed that way past v0.111.0 removing
 * `forcedTheme` — so on a light-mode OS every bold word the coach wrote was
 * white on white, a 1:1 contrast ratio, invisible. The first CI run of
 * surfaces.yml found it across five surfaces. `em` and `code` deliberately
 * carry no colour class and inherit; only emphasis needs full-strength ink.
 */
const PATTERN = /(\*\*[^*\n]+\*\*|(?<![*\w])\*[^*\n]+\*(?!\w)|`[^`\n]+`)/g;

export function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(PATTERN);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        const key = `${i}-${part.slice(0, 8)}`;
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={key} className="font-bold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={key} className="font-mono text-[0.95em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("*") && part.endsWith("*")) {
          return (
            <em key={key} className="italic">
              {part.slice(1, -1)}
            </em>
          );
        }
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}
