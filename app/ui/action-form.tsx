"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Form } from "@your-job-search-genius/odyssey-ui/components/base/form/form";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Alert, toast } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";

import type { ActionResult } from "~/lib/forms";

export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * Shared form wiring: server-side validation errors land on fields by `name`, a form-level error shows
 * in an alert above the fields, success shows a toast. The submit button blocks double submits.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  onSuccess,
  secondary,
  children,
}: {
  action: FormAction;
  submitLabel: string;
  pendingLabel?: string;
  onSuccess?: () => void;
  secondary?: ReactNode;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const handled = useRef<ActionResult>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      toast.success(state.ok);
      onSuccess?.();
    } else if (state.fieldErrors) {
      // After a failed submit, put the keyboard on the first field that needs fixing.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
  }, [state, onSuccess]);

  return (
    <Form ref={formRef} action={formAction} validationErrors={state?.fieldErrors} validationBehavior="aria" className="flex flex-col gap-5" aria-busy={pending}>
      {state?.error && (
        // Odyssey's Input shows `hint` but not React Aria's validation message, so the summary carries
        // each field's message; the fields themselves are marked invalid and the first one gets focus.
        <Alert
          color="error"
          title={state.error}
          description={state.fieldErrors ? Object.values(state.fieldErrors).join(" ") : undefined}
          autoFocus={false}
        />
      )}
      {children}
      <div className="flex flex-wrap justify-end gap-3">
        {secondary}
        <Button type="submit" size="md" isLoading={pending} showTextWhileLoading>
          {pending ? (pendingLabel ?? submitLabel) : submitLabel}
        </Button>
      </div>
    </Form>
  );
}
