/** Pure curve-thinning helpers — keep LLM/MCP payloads small (v0.4c). */

/** Nearest point per canonical target; a target with no point within ±25% is skipped. */
export function pickCanonical(
  xs: number[],
  ys: number[],
  targets: number[]
): { target: number; x: number; y: number }[] {
  const out: { target: number; x: number; y: number }[] = [];
  for (const target of targets) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const dist = Math.abs(xs[i] - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0 && bestDist <= target * 0.25) {
      out.push({ target, x: xs[best], y: ys[best] });
    }
  }
  return out;
}

/** Stride-thin a series to at most `cap` points, always keeping the endpoints. */
export function capSeries(
  xs: number[],
  ys: number[],
  cap = 50
): { x: number[]; y: number[] } {
  if (xs.length <= cap) return { x: [...xs], y: [...ys] };
  const stride = Math.ceil(xs.length / (cap - 1));
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < xs.length; i += stride) {
    x.push(xs[i]);
    y.push(ys[i]);
  }
  if (x.at(-1) !== xs.at(-1)) {
    x.push(xs.at(-1)!);
    y.push(ys.at(-1)!);
  }
  return { x, y };
}
