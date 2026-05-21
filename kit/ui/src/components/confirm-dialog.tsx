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
  pending = false,
  pendingLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <OverlayShell
      open={open}
      kind="dialog"
      onClose={onClose}
      title={title}
      footer={
        // Each button is wrapped in a `flex-1` cell so the two actions split
        // the row evenly. Buttons carry `shrink-0` in their base variant, so
        // two `fullWidth` buttons placed directly in a flex row would not
        // shrink and the second one would overflow outside the dialog.
        <div className="flex gap-3">
          <div className="flex-1">
            <Button tone="secondary" fullWidth onClick={onClose}>
              {cancelLabel}
            </Button>
          </div>
          <div className="flex-1">
            <Button tone={confirmTone} fullWidth onClick={onConfirm} disabled={pending}>
              {pending && pendingLabel ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </div>
      }
    >
      <div className="text-sm text-[var(--nimi-text-secondary)]">
        {message}
      </div>
    </OverlayShell>
  );
}
