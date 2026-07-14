/**
 * Runtime migration runner for Docker/self-host deployments.
 * Plain JS on purpose: runs inside the standalone image with only the
 * dependencies Next.js traced (drizzle-orm + pg) — no drizzle-kit, no tsx.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} catch (err) {
  console.error("migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
