/**
 * Forge Confirm Dialog — hook + component for destructive action confirmations.
 *
 * Replaces all `window.confirm()` calls with kit ConfirmDialog.
 */

import { useState, useCallback } from 'react';
import { ConfirmDialog } from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  useConfirmDialog hook                                              */
/* ------------------------------------------------------------------ */

type ConfirmState = {
  open: boolean;
  pending: boolean;
};

type ConfirmActions = {
  /** Open the dialog. Returns a promise that resolves to true (confirmed) or false (cancelled). */
  confirm: () => Promise<boolean>;
  /** Close the dialog without confirming. */
  cancel: () => void;
};

type UseConfirmDialogReturn = ConfirmState & ConfirmActions & {
  /** Props to spread onto ForgeConfirmDialog. */
  dialogProps: {
    open: boolean;
    pending: boolean;
    onConfirm: () => void;
    onClose: () => void;
  };
};

export function useConfirmDialog(): UseConfirmDialogReturn {
  const [state, setState] = useState<ConfirmState>({ open: false, pending: false });
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);

  const confirm = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
      setState({ open: true, pending: false });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState((s) => ({ ...s, pending: true }));
    resolver?.(true);
    setState({ open: false, pending: false });
    setResolver(null);
  }, [resolver]);

  const cancel = useCallback(() => {
    resolver?.(false);
    setState({ open: false, pending: false });
    setResolver(null);
  }, [resolver]);

  return {
    ...state,
    confirm,
    cancel,
    dialogProps: {
      open: state.open,
      pending: state.pending,
      onConfirm: handleConfirm,
      onClose: cancel,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  ForgeConfirmDialog                                                 */
/* ------------------------------------------------------------------ */

export function ForgeConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmTone = 'danger',
  pending = false,
  pendingLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmTone?: 'primary' | 'danger';
  pending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      confirmTone={confirmTone}
      pending={pending}
      pendingLabel={pendingLabel}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
