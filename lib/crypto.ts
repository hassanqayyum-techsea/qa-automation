import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 64);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const test = await scryptAsync(pw, salt, 64);
  return timingSafeEqual(test, hash);
}

/** GitHub's X-Hub-Signature-256 check, constant-time. */
export function verifyGithubSignature(secret: string, body: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const randomSecret = () => randomBytes(32).toString("hex");
