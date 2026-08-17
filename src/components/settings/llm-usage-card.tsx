import { requireUser } from "@/lib/session";
import { getUsageSummary } from "@/lib/llm-usage";

export async function LlmUsageCard() {
  const user = await requireUser();
  const now = new Date();
  const thisMonth = await getUsageSummary(user.id, now);
  const prevMonth = await getUsageSummary(
    user.id,
    new Date(now.getFullYear(), now.getMonth() - 1, 15)
  );
  const total = (rows: typeof thisMonth) =>
    rows.reduce(
      (s, r) => ({ in: s.in + r.inputTokens, out: s.out + r.outputTokens }),
      { in: 0, out: 0 }
    );
  const t = total(thisMonth);
  const p = total(prevMonth);
  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro">Coach usage</h3>
      <p className="mt-2 text-caption text-ink-muted">
        Tokens your own LLM endpoints processed. Tokens, not cost — pricing
        depends on your provider. Calls whose provider reports no usage
        aren&apos;t counted.
      </p>
      {thisMonth.length === 0 && prevMonth.length === 0 ? (
        <p className="mt-4 text-label text-ink-muted">No usage recorded yet.</p>
      ) : (
        <div className="mt-4 space-y-3 text-label">
          <p className="text-ink-secondary">
            This month: {t.in.toLocaleString()} in / {t.out.toLocaleString()}{" "}
            out
            {p.in + p.out > 0 && (
              <span className="text-ink-muted">
                {" "}
                · last month {p.in.toLocaleString()} / {p.out.toLocaleString()}
              </span>
            )}
          </p>
          <div className="space-y-1">
            {thisMonth
              .sort((a, b) => b.inputTokens - a.inputTokens)
              .map((r) => (
                <div
                  key={`${r.model}-${r.purpose}`}
                  className="flex justify-between text-ink-muted"
                >
                  <span>
                    {r.model} · {r.purpose} ({r.calls}×)
                  </span>
                  <span>
                    {r.inputTokens.toLocaleString()} /{" "}
                    {r.outputTokens.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
