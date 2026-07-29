/**
 * READ-ONLY. Dumps the open week_plans row(s) for one user as JSON, so a
 * repair has a precise rollback point. Pair with --user.
 *
 * Usage: npx tsx scripts/snapshot-open-week.ts --user <id>
 */
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

async function main() {
  const i = process.argv.indexOf("--user");
  const userId = i !== -1 ? process.argv[i + 1] : null;
  if (!userId) {
    console.error("--user <id> is required");
    process.exit(1);
  }
  const rows = await db.query.weekPlans.findMany({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.status, "open")
    ),
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
