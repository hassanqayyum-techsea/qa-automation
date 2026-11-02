"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { audit, requirePermission } from "~/lib/auth";
import { col, ObjectId, oid } from "~/lib/db";
import { hashPassword } from "~/lib/crypto";
import { ALL_PERMISSIONS, type Permission } from "~/lib/permissions";
import { fieldErrors, type ActionResult } from "~/lib/forms";

const password = z.string().min(12, "Use at least 12 characters.");

/** True when this change would leave no active user holding the Owner role (a lockout). */
async function removesLastOwner(userId: ObjectId, nextRoleId: ObjectId, disabled: boolean) {
  const owner = await col.roles.findOne({ name: "Owner" });
  if (!owner) return false;
  const stillOwner = nextRoleId.equals(owner._id) && !disabled;
  if (stillOwner) return false;
  const others = await col.users.countDocuments({ _id: { $ne: userId }, roleId: owner._id, disabled: { $ne: true } });
  return others === 0;
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter the person's name."),
  email: z.email("Enter a valid email address, like name@company.com."),
  roleId: z.string().refine(ObjectId.isValid, "Pick a role."),
  password,
});

export async function createUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("users:manage");
  const parsed = createSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const role = await col.roles.findOne({ _id: new ObjectId(parsed.data.roleId) });
  if (!role) return { fieldErrors: { roleId: "That role was deleted. Pick another." } };
  const email = parsed.data.email.toLowerCase();
  try {
    await col.users.insertOne({
      _id: new ObjectId(),
      name: parsed.data.name,
      email,
      roleId: role._id,
      passwordHash: await hashPassword(parsed.data.password),
      createdAt: new Date(),
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { fieldErrors: { email: "Someone already uses this email." } };
    throw e;
  }
  await audit(actor, "user.created", email, { role: role.name });
  refresh();
  return { ok: `${parsed.data.name} can now sign in. Share the password with them privately.` };
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "Enter the person's name."),
  roleId: z.string().refine(ObjectId.isValid, "Pick a role."),
  password: z.union([z.literal(""), password]).optional(),
});

/** Bind the user id: updateUser.bind(null, id). */
export async function updateUser(userId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("users:manage");
  const parsed = updateSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const _id = oid(userId);
  const user = _id && (await col.users.findOne({ _id }));
  if (!user) return { error: "That user was deleted. Reload the page." };
  const role = await col.roles.findOne({ _id: new ObjectId(parsed.data.roleId) });
  if (!role) return { fieldErrors: { roleId: "That role was deleted. Pick another." } };
  const disabled = fd.get("disabled") === "on";
  if (disabled && user._id.equals(new ObjectId(actor.id))) return { error: "You can't disable your own account." };
  if (await removesLastOwner(user._id, role._id, disabled)) {
    return { error: "This would leave no active Owner. Make someone else an Owner first." };
  }
  await col.users.updateOne(
    { _id: user._id },
    {
      $set: {
        name: parsed.data.name,
        roleId: role._id,
        disabled,
        ...(parsed.data.password ? { passwordHash: await hashPassword(parsed.data.password) } : {}),
      },
    },
  );
  await audit(actor, "user.updated", user.email, { role: role.name, disabled, passwordReset: !!parsed.data.password });
  refresh();
  return { ok: `${parsed.data.name} updated.` };
}

const roleSchema = z.object({
  name: z.string().trim().min(1, "Name the role, e.g. Team lead.").max(40),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).min(1, "Pick at least one permission."),
});

/** Bind the role id for edits: saveRole.bind(null, id); bind null to create. */
export async function saveRole(roleId: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("roles:manage");
  const parsed = roleSchema.safeParse({ name: fd.get("name"), permissions: fd.getAll("permissions") });
  if (!parsed.success) return fieldErrors(parsed.error);
  const { name, permissions } = parsed.data;
  try {
    if (roleId) {
      const role = await col.roles.findOne({ _id: oid(roleId) ?? undefined });
      if (!role) return { error: "That role was deleted. Reload the page." };
      if (role.builtIn) return { error: "Built-in roles can't be changed. Create a custom role instead." };
      await col.roles.updateOne({ _id: role._id }, { $set: { name, permissions } });
    } else {
      await col.roles.insertOne({ _id: new ObjectId(), name, permissions, builtIn: false });
    }
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return { fieldErrors: { name: "A role with this name already exists." } };
    throw e;
  }
  await audit(actor, roleId ? "role.updated" : "role.created", name, { permissions });
  refresh();
  return { ok: `Role "${name}" saved.` };
}

export async function deleteRole(roleId: string): Promise<ActionResult> {
  const actor = await requirePermission("roles:manage");
  const role = await col.roles.findOne({ _id: oid(roleId) ?? undefined });
  if (!role) return { error: "That role was already deleted." };
  if (role.builtIn) return { error: "Built-in roles can't be deleted." };
  const users = await col.users.countDocuments({ roleId: role._id });
  if (users) return { error: `${users} user(s) still have this role. Give them another role first.` };
  await col.roles.deleteOne({ _id: role._id });
  await audit(actor, "role.deleted", role.name);
  refresh();
  return { ok: `Role "${role.name}" deleted.` };
}
