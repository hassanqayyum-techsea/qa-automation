import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { forbidden, redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { col, dbReady, ObjectId } from "./db";
import { env } from "./env";
import type { Permission } from "./permissions";

const COOKIE = "session";
const TTL_DAYS = 7;
const key = new TextEncoder().encode(env.SESSION_SECRET);

export async function createSession(userId: string) {
  const expires = new Date(Date.now() + TTL_DAYS * 864e5);
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: Permission[];
};

/**
 * Data Access Layer entry point. The cookie only proves who you are; role and permissions are
 * read from MongoDB on every request, so disabling a user or editing a role applies immediately.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Everything behind auth reads live data (and the Mongo driver uses timestamps), so render at request time.
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined;
  try {
    sub = (await jwtVerify(token, key, { algorithms: ["HS256"] })).payload.sub;
  } catch {
    return null;
  }
  if (!sub || !ObjectId.isValid(sub)) return null;
  await dbReady();
  const user = await col.users.findOne({ _id: new ObjectId(sub), disabled: { $ne: true } });
  if (!user) return null;
  const role = await col.roles.findOne({ _id: user.roleId });
  return { id: sub, email: user.email, name: user.name, role: role?.name ?? "No role", permissions: role?.permissions ?? [] };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(p: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.permissions.includes(p)) forbidden();
  return user;
}

export const can = (user: SessionUser, p: Permission) => user.permissions.includes(p);

export async function audit(user: SessionUser, action: string, target: string, details?: Record<string, unknown>) {
  await col.audit.insertOne({
    _id: new ObjectId(),
    actorId: new ObjectId(user.id),
    actorEmail: user.email,
    action,
    target,
    details,
    at: new Date(),
  });
}
