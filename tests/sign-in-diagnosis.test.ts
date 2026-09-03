import { describe, expect, it } from "vitest";
import { diagnoseSignIn } from "../scripts/lib/sign-in-diagnosis";

describe("diagnoseSignIn", () => {
  // The whole reason this exists. Playwright reports every sign-in failure as
  // `page.waitForURL: Timeout`, which is the same sentence whether the server
  // rejected the origin, never registered the auth route, or the password was
  // wrong. Two different causes cost real time on 2026-09-03 — one locally
  // (403) and one in CI (404) — and the message could not tell them apart.
  it("names an Invalid origin rejection and what to change", () => {
    const msg = diagnoseSignIn({
      status: 403,
      body: '{"message":"Invalid origin"}',
    });
    expect(msg).toContain("403");
    expect(msg).toContain("BETTER_AUTH_URL");
  });

  it("names a missing auth route rather than blaming credentials", () => {
    const msg = diagnoseSignIn({ status: 404, body: "" });
    expect(msg).toContain("404");
    expect(msg).toContain("route");
    // It must not send someone to check the password. Saying "this is NOT a
    // credentials problem" is the opposite of blaming them, so assert the
    // disclaimer rather than the absence of the word.
    expect(msg).toContain("not a credentials problem");
  });

  it("says credentials when the server actually says credentials", () => {
    const msg = diagnoseSignIn({
      status: 401,
      body: '{"message":"Invalid email or password"}',
    });
    expect(msg).toContain("401");
    expect(msg).toMatch(/credential/i);
  });

  // A 200 that still fails to navigate is a different animal — the POST
  // worked, so the problem is downstream (hydration, a redirect that never
  // lands). Saying "check your password" there would send someone the wrong
  // way, which is exactly the failure this replaces.
  it("does not blame the credentials when the POST succeeded", () => {
    const msg = diagnoseSignIn({ status: 200, body: "" });
    expect(msg).toContain("200");
    expect(msg).toContain("SUCCEEDED");
    expect(msg).not.toMatch(/check OWNER_PASSWORD|wrong password/i);
  });

  // No response captured at all: the click never produced a request. Say so
  // plainly instead of inventing a cause.
  it("admits when no auth response was seen", () => {
    const msg = diagnoseSignIn(null);
    expect(msg).toMatch(/no .*response/i);
    expect(msg).not.toContain("404");
  });

  it("includes the server's own message when it sent one", () => {
    const msg = diagnoseSignIn({ status: 500, body: '{"message":"boom"}' });
    expect(msg).toContain("boom");
  });
});
