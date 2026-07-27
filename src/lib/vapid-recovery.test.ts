import { describe, expect, it } from "vitest";
import { EncryptionKeyError } from "./crypto";
import { vapidRecoveryAction } from "./vapid-recovery";

/**
 * Regression cover for the 2026-07-26 incident: the instance VAPID pair was
 * deleted and regenerated, silently orphaning every push subscription (the
 * owner's morning push reported `sent:0, pruned:1` the next morning).
 *
 * readVapidRows caught EVERY error from decrypt() and responded by deleting
 * the keypair. A missing or malformed ENCRYPTION_KEY — a recoverable config
 * fault, with the stored ciphertext still perfectly intact — was therefore
 * enough to destroy working keys instance-wide.
 */
describe("vapidRecoveryAction", () => {
  it("rethrows when the encryption key is unavailable — the pair is fine", () => {
    expect(vapidRecoveryAction(new EncryptionKeyError("missing"))).toBe(
      "rethrow"
    );
  });

  it("regenerates on an authentic decrypt failure (real rotation or corruption)", () => {
    expect(
      vapidRecoveryAction(
        new Error("Unsupported state or unable to authenticate data")
      )
    ).toBe("regenerate");
  });

  it("regenerates on a malformed stored value", () => {
    expect(
      vapidRecoveryAction(
        new Error(
          "Malformed encrypted value — expected format iv:authTag:ciphertext"
        )
      )
    ).toBe("regenerate");
  });

  it("treats a non-Error throw as an authentic failure", () => {
    expect(vapidRecoveryAction("boom")).toBe("regenerate");
    expect(vapidRecoveryAction(undefined)).toBe("regenerate");
  });
});
