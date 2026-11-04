import { MongoClient, ObjectId } from "mongodb";
import { env } from "./env";
import { BUILT_IN_ROLES, type Permission } from "./permissions";

export { ObjectId };

export interface User {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  roleId: ObjectId;
  disabled?: boolean;
  createdAt: Date;
}
export interface Role {
  _id: ObjectId;
  name: string;
  permissions: Permission[];
  builtIn: boolean;
}
export interface AuditEntry {
  _id: ObjectId;
  actorId: ObjectId;
  actorEmail: string;
  action: string;
  target: string;
  details?: Record<string, unknown>;
  at: Date;
}
export type Environment = "dev" | "staging" | "production";
export interface App {
  _id: ObjectId;
  name: string;
  baseUrl: string;
  environment: Environment;
  testLogin?: { email: string; password: string /* encrypted */ };
  createdAt: Date;
}
export interface Test {
  _id: ObjectId;
  appId: ObjectId;
  name: string;
  markdown: string;
  /** Playwright device name or a size like "1366x768". Missing on tests saved before it became a setting. */
  device?: string;
  /** Another test in the same app that runs first, so this one starts signed in. */
  sessionTestId?: ObjectId | null;
  updatedAt: Date;
  updatedBy: string;
}
/** A snapshot of a test, taken on every save and every AI generation, so any earlier state can be restored. */
export interface TestVersion {
  _id: ObjectId;
  testId: ObjectId;
  markdown: string;
  device: string;
  sessionTestId: ObjectId | null;
  source: "saved" | "draft" | "ai";
  prompt?: string;
  at: Date;
  by: string;
}
export type RunStatus = "queued" | "running" | "passed" | "failed" | "stopped";
export interface StepResult {
  text: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  ms?: number;
  note?: string;
  screenshot?: string; // base64 jpeg of the screen after the step
}
export interface TestRun {
  _id: ObjectId;
  testId: ObjectId;
  appId: ObjectId;
  testName: string;
  device: string;
  status: RunStatus;
  steps: StepResult[];
  values: Record<string, number>;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  by: string;
}

const g = globalThis as unknown as { _mongo?: MongoClient; _dbReady?: Promise<void> };
const client = (g._mongo ??= new MongoClient(env.MONGODB_URI));
const db = client.db();

export const col = {
  users: db.collection<User>("users"),
  roles: db.collection<Role>("roles"),
  audit: db.collection<AuditEntry>("auditLog"),
  apps: db.collection<App>("apps"),
  tests: db.collection<Test>("tests"),
  runs: db.collection<TestRun>("testRuns"),
  versions: db.collection<TestVersion>("testVersions"),
};

/** Indexes + built-in roles. Idempotent; memoised per process. */
export function dbReady(): Promise<void> {
  return (g._dbReady ??= (async () => {
    await Promise.all([
      col.users.createIndex({ email: 1 }, { unique: true }),
      col.roles.createIndex({ name: 1 }, { unique: true }),
      col.audit.createIndex({ at: -1 }),
      col.tests.createIndex({ appId: 1 }),
      col.runs.createIndex({ testId: 1, createdAt: -1 }),
      col.versions.createIndex({ testId: 1, at: -1 }),
    ]);
    for (const r of BUILT_IN_ROLES) {
      // Built-in roles keep their permissions in sync with code on every boot.
      await col.roles.updateOne(
        { name: r.name },
        { $set: { permissions: r.permissions, builtIn: true } },
        { upsert: true },
      );
    }
  })().catch((e) => {
    g._dbReady = undefined; // let the next call retry instead of caching a failed boot
    throw e;
  }));
}

export const oid = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
