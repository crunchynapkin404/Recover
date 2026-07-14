"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { join, type JoinResult } from "./actions";

interface Props {
  code: string;
  inviteEmail: string | null;
}

export function JoinForm({ code, inviteEmail }: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState<JoinResult | null, FormData>(
    join,
    null
  );
  const [signingIn, setSigningIn] = useState(false);
  const credentials = useRef<{ email: string; password: string } | null>(null);

  // After the account is created, sign in with the same credentials.
  useEffect(() => {
    if (!state?.ok || !credentials.current || signingIn) return;
    setSigningIn(true);
    authClient.signIn
      .email(credentials.current)
      .then(({ error }) => {
        if (!error) {
          router.push("/");
          router.refresh();
        }
      })
      .finally(() => setSigningIn(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <div className="glass w-full max-w-sm rounded-[2rem] p-8">
      <h1 className="mb-1 text-xl font-bold tracking-tighter">Join Recover</h1>
      <p className="mb-6 text-sm text-white/60">
        You&apos;ve been invited. Create your account — your training data stays
        on this server, nowhere else.
      </p>
      <form
        action={(fd) => {
          credentials.current = {
            email: String(fd.get("email") ?? ""),
            password: String(fd.get("password") ?? ""),
          };
          action(fd);
        }}
        className="grid gap-4"
      >
        <input type="hidden" name="code" value={code} />
        <div className="grid gap-1.5">
          <label htmlFor="join-name" className="label-micro">
            Name
          </label>
          <input
            id="join-name"
            name="name"
            required
            maxLength={80}
            autoComplete="name"
            className="login-input rounded-xl px-3 py-2.5 text-sm text-white"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="join-email" className="label-micro">
            Email
          </label>
          <input
            id="join-email"
            name="email"
            type="email"
            required
            defaultValue={inviteEmail ?? ""}
            autoComplete="email"
            className="login-input rounded-xl px-3 py-2.5 text-sm text-white"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="join-password" className="label-micro">
            Password (min 8 characters)
          </label>
          <input
            id="join-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="login-input rounded-xl px-3 py-2.5 text-sm text-white"
          />
        </div>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-red-400">
            {state.message}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-emerald-400">
            {state.message}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || signingIn}
          className="rounded-xl bg-emerald-500 py-3 font-bold text-black transition-all hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Creating account…" : signingIn ? "Signing in…" : "Join"}
        </button>
      </form>
    </div>
  );
}
