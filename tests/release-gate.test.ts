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

  it("release.yml builds only pre-release tags", () => {
    const body = workflow("release.yml");
    const tags = /tags:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "";

    // The v0.104.0 gate was defeated on its first release by this exact line.
    // With `["v*"]`, the FINAL vX.Y.Z tag — pushed after promotion so the repo
    // and registry agree — rebuilt the image and moved :latest to a new
    // digest, discarding the soaked one promote.yml had just published.
    // Watchtower deployed the rebuild. Everything upstream had already gone
    // green, so nothing said a word.
    expect(
      tags.includes("-rc."),
      "release.yml's tag trigger must match pre-release tags only (e.g. " +
        `"v*-rc.*"), but is [${tags}]. A trigger that also matches the final ` +
        "vX.Y.Z tag rebuilds the image after promotion and overwrites the " +
        "digest that was soaked — which is the entire point of promoting by " +
        "digest."
    ).toBe(true);
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

describe("workflow environment", () => {
  // src/lib/env-validation.ts throws below 32 characters, from the
  // instrumentation hook. vitest never runs that hook, so ci.yml got away with
  // a 14-character value for as long as CI only ever ran tests — but every job
  // that boots the real app does run it, and surfaces.yml boots the real app.
  // A workflow that boots with a short secret fails at startup with a message
  // about auth, which is a long way from the cause.
  it("every BETTER_AUTH_SECRET in a workflow is at least 32 characters", () => {
    for (const name of allWorkflowNames()) {
      const body = workflow(name);
      for (const m of body.matchAll(
        /BETTER_AUTH_SECRET:\s*["']?([^"'\s]+)["']?/g
      )) {
        const value = m[1];
        if (value.startsWith("${{")) continue; // a secret reference
        expect(
          value.length,
          `${name} sets BETTER_AUTH_SECRET to a ${value.length}-character ` +
            `value; src/lib/env-validation.ts requires 32.`
        ).toBeGreaterThanOrEqual(32);
      }
    }
  });
});

describe("self-hosted runner safety", () => {
  // The repository is PUBLIC. A fork's pull request runs that fork's workflow
  // file, so a self-hosted runner that serves pull_request is arbitrary code
  // execution on the devbox — a machine with SSH access to production and to
  // the backup volumes. Only workflow_dispatch and base-repo tag pushes may
  // target it, neither of which a fork can trigger. That is GitHub's own
  // documented mitigation, and it is the entire safety story here.
  //
  // Same reasoning as the :latest flavor guard above: a written rule that
  // nothing enforces is a rule broken by accident.
  it("no workflow pairs a self-hosted runner with a pull_request trigger", () => {
    for (const name of allWorkflowNames()) {
      const body = workflow(name);
      const selfHosted =
        /runs-on:\s*(\[[^\]]*self-hosted[^\]]*\]|self-hosted\b)/.test(body);
      if (!selfHosted) continue;
      expect(
        /^\s*pull_request(_target)?:/m.test(body),
        `${name} runs on a self-hosted runner AND triggers on pull_request. ` +
          `This repository is public: that is code execution from any fork on ` +
          `a box with SSH to production. Use workflow_dispatch.`
      ).toBe(false);
    }
  });
});
