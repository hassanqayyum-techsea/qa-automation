"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Dialog, DialogTrigger, Modal, ModalBody, ModalFooter, ModalHeader, ModalOverlay } from "@your-job-search-genius/odyssey-ui/components/application/modals/modal";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { toast } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";
import type { ActionResult } from "~/lib/forms";
import { ActionForm, type FormAction } from "./action-form";

type ButtonProps = { label: string; color?: "primary" | "secondary" | "tertiary" | "link-gray" | "link-color"; size?: "sm" | "md" };

/** A button that opens a form in a modal; the modal closes when the action succeeds. */
export function FormModal({
  trigger,
  title,
  description,
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  trigger: ButtonProps;
  title: string;
  description?: ReactNode;
  action: FormAction;
  submitLabel: string;
  pendingLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button size={trigger.size ?? "md"} color={trigger.color ?? "primary"}>{trigger.label}</Button>
      <ModalOverlay isDismissable>
        <Modal size="lg">
          <Dialog>
            <ModalHeader title={title} description={description} />
            <ModalBody className="pb-6">
              <ActionForm
                action={action}
                submitLabel={submitLabel}
                pendingLabel={pendingLabel}
                onSuccess={() => setOpen(false)}
                secondary={<Button type="button" color="secondary" size="md" onClick={() => setOpen(false)}>Cancel</Button>}
              >
                {children}
              </ActionForm>
            </ModalBody>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

/** Destructive action behind an alert dialog. Focus starts on Cancel, the safe choice. */
export function ConfirmButton({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: ButtonProps & { destructive?: boolean };
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<ActionResult | void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button size={trigger.size ?? "sm"} color={trigger.destructive ? "secondary-destructive" : (trigger.color ?? "secondary")}>
        {trigger.label}
      </Button>
      <ModalOverlay isDismissable={!pending}>
        <Modal size="sm">
          <Dialog role="alertdialog">
            <ModalHeader title={title} description={description} autoFocus={false} />
            <ModalFooter className="flex justify-end gap-3 p-6">
              <Button color="secondary" size="md" autoFocus onClick={() => setOpen(false)} isDisabled={pending}>
                Cancel
              </Button>
              <Button
                color="primary-destructive"
                size="md"
                isLoading={pending}
                showTextWhileLoading
                onClick={() =>
                  start(async () => {
                    const res = await onConfirm();
                    if (res?.error) toast.error(res.error);
                    else {
                      if (res?.ok) toast.success(res.ok);
                      setOpen(false);
                    }
                  })
                }
              >
                {confirmLabel}
              </Button>
            </ModalFooter>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
