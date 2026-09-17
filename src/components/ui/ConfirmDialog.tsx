import type { ReactNode } from "react";
import clsx from "clsx";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action (red) vs. a neutral one (amber). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A confirm/"are you sure" prompt built on the shared Modal primitive (focus trap,
 * Escape-to-close, backdrop click already handled there). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} label={title} className="w-96 rounded border border-term-border bg-term-panel p-4 shadow-xl">
      <div className="mb-2 text-sm font-semibold text-term-text">{title}</div>
      <div className="mb-4 text-2xs text-term-text-dim">{body}</div>
      <div className="flex justify-end gap-2">
        <button
          autoFocus
          onClick={onCancel}
          className="rounded-sm border border-term-border px-3 py-1 text-2xs text-term-text-mute hover:text-term-text"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          className={clsx(
            "rounded-sm border px-3 py-1 text-2xs font-semibold",
            destructive
              ? "border-term-down bg-term-down/10 text-term-down hover:bg-term-down/20"
              : "border-term-amber bg-term-amber text-black"
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
