"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { GradientDepth } from "@/components/gradient-depth";
import { LandingInfo } from "@/components/login/landing-info";
import { ShieldCheck, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(
          result.error.message ??
            "Sign in failed. Check your email and password."
        );
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error");
      setLoading(false);
    }
  }

  return (
    <div className="mesh-gradient relative flex min-h-svh flex-col items-center justify-center overflow-hidden p-6">
      <GradientDepth variant="auth" />

      {/* Logo */}
      <div className="relative z-10 mb-12 flex flex-col items-center gap-3">
        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-3xl border border-accent/20 bg-accent/10">
          <ShieldCheck className="size-8 text-accent" strokeWidth={1.5} />
        </div>
        <h1 className="text-hero font-bold tracking-tighter text-ink-primary">
          RECOVER
        </h1>
        <p className="max-w-md text-balance text-center text-body leading-relaxed text-ink-secondary">
          Your training and recovery, in one calm place — self-hosted and free.
        </p>
      </div>

      {/* Login card */}
      <div className="glass relative z-10 w-full max-w-sm rounded-[2.5rem] border-hairline p-8 shadow-2xl">
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="label-micro mb-2 ml-4 block">
                Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input w-full rounded-2xl px-6 py-4 text-caption text-ink-primary placeholder:text-ink-secondary"
              />
            </div>
            <div>
              <label className="label-micro mb-2 ml-4 block">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input w-full rounded-2xl px-6 py-4 text-caption text-ink-primary placeholder:text-ink-secondary"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="text-center text-caption text-destructive-ink"
            >
              {error}
            </p>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 font-bold text-accent-foreground transition-all duration-300 hover:opacity-90 hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
            >
              <span>{loading ? "Signing in…" : "Sign In"}</span>
              {!loading && <ArrowRight className="size-[18px]" />}
            </button>
          </div>
        </form>
      </div>

      <LandingInfo />
    </div>
  );
}
