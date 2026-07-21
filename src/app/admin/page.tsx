import { redirect } from "next/navigation";
import { desc, inArray, isNull, and, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { InviteManager } from "@/components/admin/invite-manager";
import { SecurityEvents } from "@/components/admin/security-events";
import { SyncJobsPanel } from "@/components/admin/sync-jobs-panel";

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

  // Owner-only view across ALL users' sync jobs — intentionally not scoped
  // to the calling user, unlike every other query in this app. "done" jobs
  // are excluded; the panel only needs queue/running/failed.
  const syncJobRows = await db.query.syncJobs.findMany({
    where: inArray(schema.syncJobs.status, ["pending", "running", "failed"]),
    orderBy: desc(schema.syncJobs.updatedAt),
    columns: {
      id: true,
      userId: true,
      provider: true,
      kind: true,
      status: true,
      attempts: true,
      lastError: true,
      runAfter: true,
      updatedAt: true,
    },
  });
  const userLabel = new Map(users.map((u) => [u.id, u.name || u.email]));
  const syncJobs = syncJobRows.map((j) => ({
    id: j.id,
    userId: j.userId,
    userLabel: userLabel.get(j.userId) ?? j.userId,
    provider: j.provider,
    kind: j.kind,
    status: j.status,
    attempts: j.attempts,
    lastError: j.lastError,
    runAfter: j.runAfter.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  }));

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

        <SyncJobsPanel
          jobs={syncJobs}
          users={users.map((u) => ({ id: u.id, label: u.name || u.email }))}
        />

        <SecurityEvents />
      </div>
    </AppShell>
  );
}
