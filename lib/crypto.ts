import crypto from "node:crypto";

/**
 * AES-256-GCM authenticated encryption for secrets stored in Supabase
 * (`email_secret.pass_encrypted`).
 *
 * Key material comes ONLY from the environment (EMAIL_ENC_KEY) so a leaked
 * database dump cannot be decrypted.
 *
 * Packed format:  v1.<iv base64>.<auth tag base64>.<ciphertext base64>
 */

const VERSION = "v1";
const IV_BYTES = 12; // standard GCM nonce
const KEY_BYTES = 32; // aes-256-gcm

function key(): Buffer {
  const raw = process.env.EMAIL_ENC_KEY;
  if (!raw) {
    throw new Error(
      "EMAIL_ENC_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }
  const buf = Buffer.from(raw.trim(), "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `EMAIL_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). Regenerate it with: openssl rand -base64 32`
    );
  }
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(packed: string): string {
  if (!packed) return "";
  const parts = packed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Encrypted value is not in the expected format.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const out = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return out.toString("utf8");
}
