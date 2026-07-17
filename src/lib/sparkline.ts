/**
 * Simple SVG-safe sparkline path from data, drawn into a 100×20 viewBox.
 *
 * Returns "" when fewer than two real points exist: one reading is not a
 * trend, and the honest answer is no line at all — not the horizontal
 * "M0 10 L100 10" this used to emit, which claimed stability from nothing.
 */
export function sparkPath(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  return nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * 100;
      const y = 18 - ((v - min) / range) * 16;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
