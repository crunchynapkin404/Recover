import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { PendingButton } from "./pending-button";

describe("PendingButton", () => {
  it("is an ordinary button when idle, with the caller's classes", () => {
    const html = renderToString(
      <PendingButton
        pending={false}
        type="button"
        className="rounded-full bg-accent"
      >
        Save
      </PendingButton>
    );
    expect(html).toContain('class="rounded-full bg-accent"');
    expect(html).toContain("Save");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });

  it("says work is happening, three ways at once", () => {
    const html = renderToString(
      <PendingButton pending type="button" className="x">
        Save
      </PendingButton>
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    // The default label change is a trailing ellipsis, not a replacement, so
    // a button never becomes an unlabelled "…" the way strava-card's did.
    expect(html).toContain("Save…");
  });

  it("keeps a caller's own disabled reason while idle", () => {
    // A form that is invalid is disabled for a reason unrelated to pending;
    // the primitive must add to that, not replace it.
    const html = renderToString(
      <PendingButton pending={false} disabled type="submit" className="x">
        Save
      </PendingButton>
    );
    expect(html).toContain("disabled");
  });

  it("uses an explicit pendingLabel when given", () => {
    const html = renderToString(
      <PendingButton
        pending
        type="button"
        className="x"
        pendingLabel="Syncing…"
      >
        Sync
      </PendingButton>
    );
    expect(html).toContain("Syncing…");
    expect(html).not.toContain("Sync…");
  });
});
