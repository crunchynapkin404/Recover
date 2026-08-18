/**
 * The blurred accent blobs painted over `.mesh-gradient`. EVERY depth layer in
 * the app lives in this file, and that is load-bearing rather than tidy:
 * `src/lib/design/mesh-composite.ts` scans this source to derive the worst
 * backdrop text can land on, and `tests/contrast-guard.test.ts` asserts the ink
 * ramp against it.
 *
 * It used to scan `app-shell.tsx` directly, which worked only because that file
 * is small and holds no other background. The login page also paints depth
 * blobs — at a different alpha, with a different second hue — and pointing the
 * scanner at that file instead picked up button hover states and card fills
 * too, because a page is not a shell. Both variants now live here, so the
 * scanner has one well-defined place to read and neither surface can add a
 * layer the guard cannot see.
 *
 * KEEP EVERY LAYER AS A LITERAL `bg-<color>-<n>/<alpha>` UTILITY. The scanner
 * matches that grammar and throws on anything it cannot reduce; a computed
 * class name here would be a layer nothing measures.
 */

interface Props {
  /**
   * `app` — the authenticated shell: two 5% blobs, emerald and blue.
   * `auth` — the pre-auth landing: two 10% blobs, emerald and indigo, blurred
   * wider. Deliberately stronger, because there is no content grid competing
   * with them there.
   */
  variant?: "app" | "auth";
}

export function GradientDepth({ variant = "app" }: Props) {
  if (variant === "auth") {
    return (
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10%] top-[-5%] h-[60%] w-[60%] rounded-full bg-emerald-500/10 blur-[150px]" />
        <div className="absolute bottom-[10%] right-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/10 blur-[150px]" />
      </div>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute left-[-10%] top-[-10%] h-1/2 w-[60%] rounded-full bg-emerald-500/5 blur-[120px]" />
      <div className="absolute bottom-[10%] right-[-10%] h-[40%] w-[50%] rounded-full bg-blue-500/5 blur-[120px]" />
    </div>
  );
}
