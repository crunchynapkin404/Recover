import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Server-side session guard for pages and server actions. Returns both the
 * session and user — use this (over `requireUser`) whenever the caller
 * needs to know *which* session it is (e.g. session-management UI marking
 * "this device").
 */
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  return session;
}

/** Server-side session guard for pages and server actions. */
export async function requireUser() {
  const session = await requireSession();
  return session.user;
}
