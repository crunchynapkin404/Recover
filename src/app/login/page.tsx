"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
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
      {/* Depth layers */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-10%] top-[-5%] h-[60%] w-[60%] rounded-full bg-emerald-500/10 blur-[150px]" />
        <div className="absolute bottom-[10%] right-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/10 blur-[150px]" />
      </div>

      {/* Logo */}
      <div className="relative z-10 mb-12 flex flex-col items-center gap-3">
        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-3xl border border-emerald-500/20 bg-emerald-500/10">
          <ShieldCheck className="size-8 text-emerald-400" strokeWidth={1.5} />
        </div>
        <h1 className="text-4xl font-bold tracking-tighter text-white">
          RECOVER
        </h1>
        <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/30">
          Recovery &amp; Training Analytics
        </span>
      </div>

      {/* Login card */}
      <div className="glass relative z-10 w-full max-w-sm rounded-[2.5rem] border-white/5 p-8 shadow-2xl">
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
                className="login-input w-full rounded-2xl px-6 py-4 text-sm text-white placeholder:text-white/20"
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
                className="login-input w-full rounded-2xl px-6 py-4 text-sm text-white placeholder:text-white/20"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-center text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-4 font-bold text-black transition-all duration-300 hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
            >
              <span>{loading ? "Signing in…" : "Sign In"}</span>
              {!loading && <ArrowRight className="size-[18px]" />}
            </button>
          </div>
        </form>
      </div>

      {/* Tagline */}
      <div className="relative z-10 mt-12 text-center opacity-40">
        <p className="text-xs font-medium tracking-wide text-white/60">
          Built for athletes who own their data.
        </p>
      </div>

      {/* Footer */}
      <div className="mt-auto pb-8">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/10">
          Invite Only · Self-Hosted
        </p>
      </div>
    </div>
  );
}
