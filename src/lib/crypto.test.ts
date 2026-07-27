import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, EncryptionKeyError } from "./crypto";

const KEY_A = randomBytes(32).toString("hex");
const KEY_B = randomBytes(32).toString("hex");

describe("crypto (ported from KOM-Wars — Principle-1 validation)", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY_A;
  });

  it("round-trips plaintext", () => {
    const secret = "intervals-api-key-1a2b3c🚴";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("produces a fresh IV per call (no ciphertext reuse)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    const enc = encrypt("secret");
    const [iv, tag, data] = enc.split(":");
    const flipped = data.slice(0, -1) + (data.endsWith("0") ? "1" : "0");
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const enc = encrypt("secret");
    const [iv, tag, data] = enc.split(":");
    const badTag = tag.slice(0, -1) + (tag.endsWith("0") ? "1" : "0");
    expect(() => decrypt(`${iv}:${badTag}:${data}`)).toThrow();
  });

  it("rejects decryption with the wrong key", () => {
    const enc = encrypt("secret");
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(() => decrypt(enc)).toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => decrypt("not-three-parts")).toThrow(/Malformed/);
    expect(() => decrypt("aa:bb:cc")).toThrow(/Invalid IV length/);
  });

  it("rejects a missing or malformed ENCRYPTION_KEY", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = "too-short";
    expect(() => encrypt("x")).toThrow(/64 hex/);
  });

  // A missing/malformed key is a RECOVERABLE config fault: the ciphertext is
  // still perfectly good. Callers that react destructively to decrypt failure
  // (push.ts regenerates the VAPID pair) must be able to tell it apart from an
  // authentic failure, or a transient env gap destroys data that was fine.
  describe("key-availability faults are distinguishable", () => {
    /** Explicit instanceof — `toThrow(Class)` passes vacuously if Class is undefined. */
    const thrownBy = (fn: () => unknown): unknown => {
      try {
        fn();
      } catch (err) {
        return err;
      }
      throw new Error("expected the call to throw, but it did not");
    };

    it("exports EncryptionKeyError as an Error subclass", () => {
      expect(typeof EncryptionKeyError).toBe("function");
      expect(new EncryptionKeyError("x")).toBeInstanceOf(Error);
    });

    it("throws EncryptionKeyError when the key is missing", () => {
      delete process.env.ENCRYPTION_KEY;
      expect(thrownBy(() => decrypt("aa:bb:cc"))).toBeInstanceOf(
        EncryptionKeyError
      );
    });

    it("throws EncryptionKeyError when the key is malformed", () => {
      process.env.ENCRYPTION_KEY = "too-short";
      expect(thrownBy(() => decrypt("aa:bb:cc"))).toBeInstanceOf(
        EncryptionKeyError
      );
    });

    it("does NOT throw EncryptionKeyError for an authentic decrypt failure", () => {
      const enc = encrypt("secret");
      process.env.ENCRYPTION_KEY = KEY_B;
      expect(thrownBy(() => decrypt(enc))).not.toBeInstanceOf(
        EncryptionKeyError
      );
    });

    it("does NOT throw EncryptionKeyError for malformed ciphertext", () => {
      expect(thrownBy(() => decrypt("not-three-parts"))).not.toBeInstanceOf(
        EncryptionKeyError
      );
    });
  });
});
