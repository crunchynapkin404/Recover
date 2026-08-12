/**
 * WCAG 2.2 relative luminance and contrast ratio, for
 * tests/contrast-guard.test.ts (Phase 2b.4, v0.99.0).
 *
 * Deliberately hex-only: the guard must reject rgba() tokens rather than
 * guess what they composite to. A translucent value has no single ratio —
 * that ambiguity is exactly the defect this release removes.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): [number, number, number] {
  if (!HEX.test(hex)) {
    throw new Error(
      `contrast: expected a six-digit hex colour, got ${JSON.stringify(hex)}`
    );
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function channel(value8Bit: number): number {
  const c = value8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
