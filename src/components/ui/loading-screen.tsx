/**
 * The status semantics every `loading.tsx` needs, in one place so eight files
 * cannot spell them eight ways.
 *
 * WHY THIS EXISTS. Before it, all six loading states were skeletons and
 * nothing else — no role, no live region, no text. Motion was the only
 * carrier of "this is loading", which leaves out two audiences at once: a
 * screen-reader user heard silence, and a reduced-motion user saw a static
 * grey page, because globals.css stops `.animate-pulse` outright under
 * `prefers-reduced-motion`.
 *
 * `aria-live="polite"` rather than `assertive`: a route transition is not an
 * interruption, and the region is present from first paint so the label is
 * read as the page arrives.
 */
export function LoadingScreen({
  label,
  children,
}: {
  /** The surface being loaded, in the athlete's words: "Train", "your day". */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}
