import { EncryptionKeyError } from "@/lib/crypto";

/**
 * How `readVapidRows` should react when the stored VAPID private key will not
 * decrypt. Pure so it can be tested without touching `app_config` — those rows
 * are instance-global and shared with the live app, so a test that exercised
 * the destructive branch against the real database would orphan real push
 * subscriptions (the exact harm this guards against).
 *
 * - "rethrow"    — the key was unavailable. The ciphertext is fine; failing
 *                  loudly is recoverable, destroying the pair is not.
 * - "regenerate" — the value genuinely cannot be recovered (ENCRYPTION_KEY
 *                  really was rotated, or the row is corrupt). A fresh pair is
 *                  the only way out; subscribers re-enable notifications once.
 */
export function vapidRecoveryAction(err: unknown): "rethrow" | "regenerate" {
  return err instanceof EncryptionKeyError ? "rethrow" : "regenerate";
}
