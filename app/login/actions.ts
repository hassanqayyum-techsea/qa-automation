"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { col, dbReady, ObjectId } from "~/lib/db";
import { hashPassword, verifyPassword } from "~/lib/crypto";
import { createSession, deleteSession } from "~/lib/auth";
import { redis } from "~/lib/redis";
import { fieldErrors, type ActionResult } from "~/lib/forms";

const MAX_ATTEMPTS = 10; // per email per 15 minutes

const loginSchema = z.object({
  email: z.email("Enter the email address for your account, like name@company.com."),
  password: z.string().min(1, "Enter your password."),
});

export async function login(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const email = parsed.data.email.toLowerCase();

  const attemptsKey = `login:${email}`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, 15 * 60);
  if (attempts > MAX_ATTEMPTS) {
    return { error: "Too many sign-in attempts for this email. Wait 15 minutes, then try again." };
  }

  await dbReady();
  const user = await col.users.findOne({ email });
  // Same message for unknown email, wrong password and disabled account, so emails can't be probed.
  if (!user || user.disabled || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "That email and password don't match an active account. Check both and try again." };
  }
  await redis.del(attemptsKey);
  await createSession(user._id.toString());
  redirect("/");
}

const ownerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter a valid email address, like name@company.com."),
  password: z.string().min(12, "Use at least 12 characters."),
});

/** First-run only: creates the Owner while the users collection is empty. */
export async function createOwner(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await dbReady();
  // ponytail: count check, not a lock; two simultaneous first-run submits could both pass. Fine for a one-time setup screen.
  if ((await col.users.countDocuments({}, { limit: 1 })) > 0) {
    return { error: "An owner account already exists. Reload the page and sign in instead." };
  }
  const parsed = ownerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const owner = await col.roles.findOne({ name: "Owner" });
  if (!owner) return { error: "The Owner role is missing. Restart the app so it can be recreated." };
  const _id = new ObjectId();
  await col.users.insertOne({
    _id,
    name: parsed.data.name,
    email: parsed.data.email.toLowerCase(),
    passwordHash: await hashPassword(parsed.data.password),
    roleId: owner._id,
    createdAt: new Date(),
  });
  await createSession(_id.toString());
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
