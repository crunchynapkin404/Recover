import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

type Database = NeonHttpDatabase<typeof schema> | NodePgDatabase<typeof schema>;

let _db: Database | null = null;

function getDb(): Database {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }

    if (process.env.DATABASE_DRIVER === "pg") {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      _db = drizzleNodePg(pool, { schema });
    } else {
      const sql = neon(process.env.DATABASE_URL);
      _db = drizzleNeonHttp(sql, { schema });
    }
  }
  return _db;
}

export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(getDb(), prop);
  },
});

export { schema };
