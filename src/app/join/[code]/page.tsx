import { findValidInvite } from "@/lib/invites";
import { JoinForm } from "./join-form";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const { invite, reason } = await findValidInvite(code);

  if (!invite) {
    const messages = {
      invalid: "This invite link isn't valid.",
      expired: "This invite has expired — ask your friend for a new one.",
      used: "This invite has already been used.",
    } as const;
    return (
      <main className="mesh-gradient flex min-h-svh items-center justify-center p-6">
        <div className="glass w-full max-w-sm rounded-[2rem] p-8 text-center">
          <h1 className="mb-2 text-xl font-bold tracking-tighter">Recover</h1>
          <p className="text-sm text-white/60">{messages[reason!]}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mesh-gradient flex min-h-svh items-center justify-center p-6">
      <JoinForm code={code} inviteEmail={invite.email} />
    </main>
  );
}
