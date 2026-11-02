import type { ZodError } from "zod";

/** What every server action used with <ActionForm> returns. */
export type ActionResult = { ok?: string; error?: string; fieldErrors?: Record<string, string> } | null;

/** zod error → field messages keyed by input `name` (first message per field). */
export function fieldErrors(err: ZodError): ActionResult {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return { fieldErrors: out, error: "Some fields need fixing. Check the message under each one." };
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
