// tests/release-gate.test.ts — v0.104.0's guardrail.
//
// The release gate is not a mechanism; it is an ABSENCE. `release.yml`
// publishes a pre-release tag without moving `:latest` only because
// docker/metadata-action's `latest` flavor is left at its default `auto`,
// which excludes pre-releases. Nothing in the repository says so. One later
// edit — `flavor: latest=true`, or a hand-written `-t …:latest` — silently
// re-arms the straight-to-prod path this release exists to close, and no test
// would fail. Prod's watchtower follows `:latest` and only `:latest`, on a
// 300s poll, so re-arming it means release candidates deploy themselves to the
// athlete within five minutes.
//
// Proven empirically before this guard was written (docs/ENVIRONMENTS.md):
// pushing v0.104.0-rc.0 published :0.104.0-rc.0 and left :latest untouched.
// This test is what keeps that true.
//
// It is the same reasoning that put the `verify` job into release.yml after
// v0.63.0 and v0.64.0 were both tagged from commits whose CI had already
// failed: a written rule that nothing enforces is a rule that gets broken by
// accident.
//
// Comments are stripped before scanning, because release.yml's own prose says
// "semver + auto `:latest`" — a naive substring scan would match that and fail
// on a correct file.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

function stripComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
}

function workflow(name: string): string {
  return stripComments(readFileSync(join(WORKFLOWS, name), "utf8"));
}

function allWorkflowNames(): string[] {
  return readdirSync(WORKFLOWS).filter(
    (f) => f.endsWith(".yml") || f.endsWith(".yaml")
  );
}

describe("release gate", () => {
  it("release.yml never forces the latest flavor", () => {
    const body = workflow("release.yml");

    expect(
      /latest\s*=\s*true/.test(body),
      "release.yml sets `latest=true`, which makes docker/metadata-action tag " +
        "EVERY release — including a -rc.N pre-release — as :latest. That is " +
        "the only tag prod's watchtower follows, so release candidates would " +
        "deploy straight to the athlete. Remove it; the default `auto` " +
        "already excludes pre-releases."
    ).toBe(false);

    expect(
      /type\s*=\s*raw\s*,\s*value\s*=\s*latest/.test(body),
      "release.yml hand-writes a raw :latest tag, which bypasses the " +
        "pre-release exclusion the gate depends on."
    ).toBe(false);
  });

  it("promote.yml is the only workflow that writes :latest", () => {
    const writers = allWorkflowNames().filter((name) =>
      /:latest/.test(workflow(name))
    );

    expect(
      writers,
      "Exactly one workflow may write the :latest tag — promote.yml, which " +
        "retags a digest already soaked on the dev box. Any other writer is " +
        "an undocumented path to production."
    ).toEqual(["promote.yml"]);
  });

  it("promote.yml promotes by digest and never rebuilds", () => {
    const body = workflow("promote.yml");

    expect(body).toContain("imagetools create");

    // `\b` after "build" matters: without it this also matches `docker buildx`,
    // which is what promotion legitimately uses. The first version of this
    // guard failed a correct promote.yml for exactly that reason.
    expect(
      /build-push-action|docker\s+build\b/.test(body),
      "promote.yml builds an image. Promotion must retag the digest that was " +
        "soaked, not produce a new one — a rebuilt image is not the artifact " +
        "that was tested, and npm resolution plus base-image drift are exactly " +
        "the risks the soak exists to eliminate."
    ).toBe(false);
  });
});
