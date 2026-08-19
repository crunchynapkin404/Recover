"use client";

import { useSyncExternalStore } from "react";

/**
 * A subscribe that never fires. Hydration happens once and never reverses,
 * so there is nothing to subscribe to — the store exists only for its
 * server/client snapshot split.
 */
const subscribeNever = () => () => {};

/**
 * `false` on the server and for the hydrating render; `true` from the render
 * after that.
 *
 * The one legitimate way to render something that CANNOT agree between server
 * and client — a browser capability, a wall-clock time in the viewer's own
 * timezone — without React throwing "Hydration failed because the server
 * rendered HTML didn't match the client" and regenerating the tree.
 * `useSyncExternalStore`'s third argument is a server snapshot, which React
 * uses for SSR and for hydration before re-reading the client one, so the
 * first client render agrees with the server BY CONSTRUCTION rather than by
 * discipline.
 *
 * Reach for this only when the value genuinely cannot be resolved on the
 * server. If it can — a date the server already knows, a label it could
 * format once — resolve it there and pass it down instead; that renders
 * correctly with no JS at all, which this does not.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}
