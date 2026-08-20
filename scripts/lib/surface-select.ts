/**
 * Surface filtering for verify-surfaces.ts.
 *
 * WHY THIS EXISTS. The capture cannot run as one job. `previewStateFrom`
 * (src/lib/today/state.ts) returns null when NODE_ENV === "production", so a
 * production build renders whichever state the clock dictates for all three
 * `today*` surfaces — and assertTodayStatesDiffer() then fails the run on the
 * byte-identical PNGs, correctly. So the production-build job must exclude
 * those three and a dev-server job must capture exactly them.
 *
 * Before this, `process.argv[2]` was only an output directory name: main()
 * always walked every surface, so the documented "capture those three against
 * a dev server, everything else against the soak stack" was not actually
 * expressible.
 *
 * Every rejection below is loud on purpose. A filter that quietly matches
 * nothing reports a clean run over an empty capture, which is the same shape
 * as the defects this whole pipeline exists to catch.
 */
export interface SurfaceSelection {
  only?: readonly string[];
  except?: readonly string[];
}

export function selectSurfaces(
  all: readonly string[],
  { only, except }: SurfaceSelection
): string[] {
  if (only && except) {
    throw new Error(
      "surface selection: pass --only or --except, not both — they cannot be " +
        "combined without an ordering rule nobody would remember."
    );
  }

  const known = new Set(all);
  const unknown = [...(only ?? []), ...(except ?? [])].filter(
    (n) => !known.has(n)
  );
  if (unknown.length > 0) {
    throw new Error(
      `surface selection: unknown surface(s) ${unknown.join(", ")}. ` +
        `Known surfaces: ${all.join(", ")}`
    );
  }

  let selected = [...all];
  if (only) {
    const wanted = new Set(only);
    selected = all.filter((n) => wanted.has(n));
  } else if (except) {
    const dropped = new Set(except);
    selected = all.filter((n) => !dropped.has(n));
  }

  if (selected.length === 0) {
    throw new Error("surface selection: no surfaces left to capture.");
  }
  return selected;
}
