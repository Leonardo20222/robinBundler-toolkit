import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";

export function encryptSecret(plaintext: string, passphrase: string): {
  ciphertext: string;
  iv: string;
  salt: string;
} {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("hex"),
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
  };
}

export function decryptSecret(
  ciphertextHex: string,
  ivHex: string,
  saltHex: string,
  passphrase: string,
): string {
  const salt = Buffer.from(saltHex, "hex");
  const key = scryptSync(passphrase, salt, 32);
  const iv = Buffer.from(ivHex, "hex");
  const data = Buffer.from(ciphertextHex, "hex");
  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
