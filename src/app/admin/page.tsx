import { redirect } from "next/navigation";
import { desc, isNull, and, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { InviteManager } from "@/components/admin/invite-manager";

export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");

  const users = await db.query.users.findMany({
    orderBy: desc(schema.users.createdAt),
    columns: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  const openInvites = await db.query.invites.findMany({
    where: and(
      isNull(schema.invites.usedByUserId),
      gte(schema.invites.expiresAt, new Date())
    ),
    orderBy: desc(schema.invites.createdAt),
  });

  return (
    <AppShell>
      <header className="mb-8 pt-8">
        <h1 className="text-2xl font-bold tracking-tighter">Admin</h1>
        <p className="mt-1 text-xs font-medium uppercase tracking-widest text-white/50">
          Members & invites
        </p>
      </header>

      <div className="space-y-6">
        <section className="glass rounded-[2rem] p-6">
          <h3 className="label-micro mb-4">Members ({users.length})</h3>
          <ul className="divide-y divide-white/5">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{u.name}</p>
                  <p className="truncate text-xs text-white/50">{u.email}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${
                    u.role === "owner"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-white/5 text-white/60"
                  }`}
                >
                  {u.role}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <InviteManager
          invites={openInvites.map((i) => ({
            id: i.id,
            code: i.code,
            email: i.email,
            expiresAt: i.expiresAt.toISOString().slice(0, 10),
          }))}
        />
      </div>
    </AppShell>
  );
}
