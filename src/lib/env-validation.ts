/**
 * Boot-time secret validation. Better Auth reads BETTER_AUTH_SECRET from env;
 * if it's missing it falls back to an ephemeral/degraded secret that breaks
 * sessions on restart and weakens cookie signing. Fail loud instead — the same
 * discipline crypto.ts applies to ENCRYPTION_KEY.
 */
export function assertAuthSecret(
  env: Partial<NodeJS.ProcessEnv> = process.env
): void {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET env var is missing. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters — use a 32-byte random hex string."
    );
  }
}
