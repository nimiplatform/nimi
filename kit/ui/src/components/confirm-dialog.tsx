import type { ReactNode } from 'react';
import { OverlayShell } from './dialog.js';
import { Button } from './button.js';
import type { ActionTone } from '../design-tokens.js';

type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmTone?: Extract<ActionTone, 'primary' | 'danger'>;
  /** Async submission in progress: confirmation shows a spinner and the
   * dialog's confirm, cancel, backdrop, and Escape dismissal are locked. */
  loading?: boolean;
  /**
   * @deprecated Use `loading` instead. Maps to the Button `loading` state
   * (spinner + `aria-busy` + disabled).
   */
  pending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmTone = 'danger',
  loading,
  pending,
  pendingLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const submitting = loading ?? pending ?? false;
  return (
    <OverlayShell
      open={open}
      kind="dialog"
      onClose={submitting ? undefined : onClose}
      title={title}
      footer={
        // Each button is wrapped in a `flex-1` cell so the two actions split
        // the row evenly. Buttons carry `shrink-0` in their base variant, so
        // two `fullWidth` buttons placed directly in a flex row would not
        // shrink and the second one would overflow outside the dialog.
        <div className="flex gap-3">
          <div className="flex-1">
            <Button tone="secondary" fullWidth onClick={onClose} disabled={submitting}>
              {cancelLabel}
            </Button>
          </div>
          <div className="flex-1">
            <Button tone={confirmTone} fullWidth onClick={onConfirm} loading={submitting}>
              {submitting && pendingLabel ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </div>
      }
    >
      <div className="text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-secondary)]">
        {message}
      </div>
    </OverlayShell>
  );
}
