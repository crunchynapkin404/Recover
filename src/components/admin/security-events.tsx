import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const EVENT_LABEL: Record<string, string> = {
  login_success: "Login",
  login_fail: "Failed login",
  token_created: "Token created",
  token_revoked: "Token revoked",
  connection_added: "Connection added",
  connection_revoked: "Connection removed",
};

export async function SecurityEvents() {
  const events = await db.query.auditLog.findMany({
    orderBy: desc(schema.auditLog.createdAt),
    limit: 50,
  });

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro mb-4">
        Recent security events ({events.length})
      </h3>
      {events.length === 0 ? (
        <p className="text-sm text-white/50">No events recorded yet.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold">
                  {EVENT_LABEL[e.event] ?? e.event}
                </p>
                <p className="truncate text-[10px] text-white/40">
                  {e.ip ?? "—"} ·{" "}
                  {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
