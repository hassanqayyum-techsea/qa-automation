"use client";

import { Input } from "@your-job-search-genius/odyssey-ui/components/base/input/input";
import { ActionForm } from "~/app/ui/action-form";
import { createOwner, login } from "./actions";

export function LoginForm() {
  return (
    <ActionForm action={login} submitLabel="Sign in" pendingLabel="Signing in…">
      <Input name="email" type="email" label="Email" autoComplete="username" isRequired />
      <Input name="password" type="password" label="Password" autoComplete="current-password" isRequired />
    </ActionForm>
  );
}

export function OwnerForm() {
  return (
    <ActionForm action={createOwner} submitLabel="Create owner account" pendingLabel="Creating account…">
      <Input name="name" label="Your name" autoComplete="name" isRequired />
      <Input name="email" type="email" label="Email" autoComplete="email" isRequired />
      <Input
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        hint="At least 12 characters."
        isRequired
      />
    </ActionForm>
  );
}
