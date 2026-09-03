/**
 * Turn a sign-in failure into a sentence that names its cause.
 *
 * Playwright reports EVERY failed sign-in identically:
 * `page.waitForURL: Timeout 15000ms exceeded`. That one sentence covers a
 * rejected origin, an auth route the router never registered, and a genuinely
 * wrong password — three problems with three different fixes.
 *
 * Both of the first two were hit on 2026-09-03 and each cost real time:
 * locally a **403 Invalid origin**, because `BETTER_AUTH_URL` pinned port 3000
 * while the capture server ran on 3200; in CI a **404**, because the auth
 * route had not registered yet under `next dev`. The capture error was word
 * for word the same, and only the SERVER log distinguished them.
 *
 * So capture what the server actually answered and say it. Pure, so the
 * wording is testable without a browser.
 */
export interface SignInResponse {
  status: number;
  /** Response body, possibly empty. Only used to surface a server message. */
  body: string;
}

/** The server's own `message` field, when it sent parseable JSON with one. */
function serverMessage(body: string): string | null {
  if (!body.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    // Not JSON. The status alone is still worth reporting.
  }
  return null;
}

export function diagnoseSignIn(res: SignInResponse | null): string {
  if (res == null) {
    return (
      "No sign-in response was seen at all — the submit produced no request " +
      "to /api/auth/sign-in/email. The form probably never became " +
      "interactive; check the login page rendered and hydrated."
    );
  }

  const said = serverMessage(res.body);
  const tail = said ? ` The server said: "${said}".` : "";

  if (res.status === 403) {
    return (
      `The server answered ${res.status} to the sign-in POST.${tail} ` +
      "A 403 here is almost always a rejected origin: BETTER_AUTH_URL (and " +
      "TRUSTED_ORIGINS) must name the SAME host and port the capture is " +
      "driving. This is not a credentials problem."
    );
  }

  if (res.status === 404) {
    return (
      `The server answered ${res.status} to the sign-in POST.${tail} ` +
      "The auth route did not resolve — it is not registered, rather than " +
      "refusing the request. Under `next dev` this can mean the route tree " +
      "had not compiled yet; under a production build, that the build is " +
      "missing it. This is not a credentials problem."
    );
  }

  if (res.status === 401) {
    return (
      `The server answered ${res.status} to the sign-in POST.${tail} ` +
      "That is the server rejecting the credentials themselves — check " +
      "OWNER_EMAIL and OWNER_PASSWORD against the seeded account."
    );
  }

  if (res.status >= 200 && res.status < 300) {
    return (
      `The sign-in POST SUCCEEDED (${res.status}) but the page never reached ` +
      `the app.${tail} The problem is after authentication — a redirect that ` +
      "did not land, or a first render that threw. Read the server log."
    );
  }

  return (
    `The server answered ${res.status} to the sign-in POST.${tail} ` +
    "Read the server log — the capture cannot see more than the status."
  );
}
