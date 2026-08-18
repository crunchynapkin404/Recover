import { desc, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SECURITY_EVENTS } from "@/lib/audit";

const EVENT_LABEL: Record<string, string> = {
  login_success: "Login",
  login_fail: "Failed login",
  token_created: "Token created",
  token_revoked: "Token revoked",
  connection_added: "Connection added",
  connection_revoked: "Connection removed",
  webhook_created: "Webhook created",
  webhook_revoked: "Webhook revoked",
  session_revoked: "Session revoked",
  session_revoked_others: "Signed out other sessions",
};

export async function SecurityEvents() {
  // Security kinds only. audit_log also carries operational rows (push_sent),
  // which at a few per user per day would fill these 50 slots within a day and
  // bury the logins and token grants this view exists to surface.
  const events = await db.query.auditLog.findMany({
    where: inArray(schema.auditLog.event, SECURITY_EVENTS),
    orderBy: desc(schema.auditLog.createdAt),
    limit: 50,
  });

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro mb-4">
        Recent security events ({events.length})
      </h3>
      {events.length === 0 ? (
        <p className="text-caption text-ink-secondary">
          No events recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-caption font-bold">
                  {EVENT_LABEL[e.event] ?? e.event}
                </p>
                <p className="truncate text-label text-ink-secondary">
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
