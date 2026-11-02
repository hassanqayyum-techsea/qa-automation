import { z } from "zod";

export const env = z
  .object({
    MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/repo-pulse"),
    REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes, base64-encoded"),
    APP_URL: z.url().default("http://localhost:3000"),
  })
  .parse(process.env);
