"use client";

import { useActionState, useState, useTransition } from "react";
import { Copy, Trash2 } from "lucide-react";
import {
  createInvite,
  revokeInvite,
  type AdminActionResult,
} from "@/app/admin/actions";

interface Props {
  invites: Array<{
    id: string;
    code: string;
    email: string | null;
    expiresAt: string;
  }>;
}

export function InviteManager({ invites }: Props) {
  const [state, action, pending] = useActionState<
    AdminActionResult | null,
    FormData
  >(createInvite, null);
  const [, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const copyLink = (code: string) => {
    const url = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro mb-4">Invites</h3>

      <form action={action} className="mb-5 flex gap-2">
        <input
          name="email"
          type="email"
          placeholder="friend@email.com (optional)"
          aria-label="Invitee email (optional)"
          className="login-input flex-1 rounded-xl px-3 py-2.5 text-sm text-white"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-black transition-all hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Creating…" : "New invite"}
        </button>
      </form>

      {state && (
        <p
          role="status"
          className={`mb-4 text-sm ${state.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {state.message}
          {state.code && (
            <button
              type="button"
              onClick={() => copyLink(state.code!)}
              className="ml-2 underline decoration-emerald-400/40 underline-offset-2"
            >
              {copied === state.code ? "Copied!" : "Copy link"}
            </button>
          )}
        </p>
      )}

      {invites.length === 0 ? (
        <p className="text-sm text-white/50">No open invites.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{invite.code}</p>
                <p className="truncate text-xs text-white/50">
                  {invite.email ?? "anyone"} · expires {invite.expiresAt}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => copyLink(invite.code)}
                  aria-label={`Copy invite link for ${invite.email ?? invite.code}`}
                  className="rounded-full p-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white"
                >
                  {copied === invite.code ? (
                    <span className="text-[9px] font-bold text-emerald-400">
                      ✓
                    </span>
                  ) : (
                    <Copy aria-hidden className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await revokeInvite(invite.id);
                    })
                  }
                  aria-label={`Revoke invite ${invite.code}`}
                  className="rounded-full p-2 text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
