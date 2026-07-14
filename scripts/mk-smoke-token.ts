/**
 * Create a short-lived MCP smoke-test token for the owner (P4R DoD check).
 * Usage: npx tsx scripts/mk-smoke-token.ts  → prints the plaintext token.
 * Revoke afterwards from Settings → API tokens (label: p4r-smoke-test).
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { hashToken, lookupPrefixFromHash } from "../src/lib/mcp/token-auth";

async function main() {
  const owner = await db.query.users.findFirst({
    where: eq(schema.users.role, "owner"),
  });
  if (!owner) throw new Error("no owner user found");

  const plaintext = `rec_${randomBytes(24).toString("hex")}`;
  const hash = hashToken(plaintext);
  await db.insert(schema.apiTokens).values({
    userId: owner.id,
    tokenHash: hash,
    lookupPrefix: lookupPrefixFromHash(hash),
    label: "p4r-smoke-test",
    scopes: "read|write:wellness",
  });
  console.log(plaintext);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
