import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "./crypto";

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
});
