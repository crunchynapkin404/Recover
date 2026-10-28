import { computeAccessibleName } from "dom-accessibility-api";

/**
 * WCAG 2.5.3 "Label in Name", the way axe-core's `label-content-name-mismatch`
 * rule checks it (axe 4.14 enables that rule by default). The rule needs real
 * layout, so in jsdom `axe()` silently passes; this mirrors its logic instead.
 *
 * - Visible text: every text node except those inside `.sr-only`, joined with
 *   NO separator — axe's `visibleVirtual` does exactly that, so "Oct 24"
 *   followed by a "24" badge reads as "oct 2424". `aria-hidden` text still
 *   counts: it is hidden from screen readers, not from the screen.
 * - Both strings are tokenised the way axe does: parentheticals dropped,
 *   anything that is not a letter or digit becomes a separator.
 * - The visible tokens must appear as one contiguous run inside the name.
 *
 * Speech-input users say what they see; this is what lets "click Mo" reach a
 * button whose name is "Mo, Monday, rest".
 */
function tokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function visibleText(el: Element): string {
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? "";
      return;
    }
    if (node instanceof Element && node.classList.contains("sr-only")) return;
    node.childNodes.forEach(walk);
  };
  walk(el);
  return text;
}

export function labelInName(el: Element): {
  ok: boolean;
  visible: string;
  name: string;
} {
  const visible = visibleText(el);
  const name = computeAccessibleName(el);
  const v = tokens(visible);
  const n = tokens(name);
  let ok = v.length === 0;
  for (let i = 0; !ok && i + v.length <= n.length; i++) {
    ok = v.every((t, j) => n[i + j] === t);
  }
  return { ok, visible, name };
}
