import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { E2E_IDS } from '../../testability/e2e-ids';

type RejectGiftDialogProps = {
  actorName: string;
  rejectReason: string;
  pending: boolean;
  title: string;
  description: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  cancelLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function RejectGiftDialog(props: RejectGiftDialogProps) {
  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={props.pending ? undefined : props.onCancel}
      title={<h2 className="text-lg font-bold text-[var(--nimi-text-primary)]">{props.title}</h2>}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button tone="secondary" onClick={props.onCancel} disabled={props.pending}>
            {props.cancelLabel}
          </Button>
          <Button tone="danger" onClick={props.onSubmit} disabled={props.pending}>
            {props.pending ? props.pendingLabel : props.confirmLabel}
          </Button>
        </div>
      )}
      dataTestId={E2E_IDS.notificationRejectGiftDialog}
      panelClassName="w-full max-w-md"
    >
      <p className="text-sm text-[var(--nimi-text-secondary)]">{props.description}</p>
      <label className="mt-4 block text-xs font-medium text-[var(--nimi-text-secondary)]" htmlFor="gift-reject-reason">
        {props.reasonLabel}
      </label>
      <textarea
        id="gift-reject-reason"
        value={props.rejectReason}
        onChange={(event) => props.onReasonChange(event.target.value)}
        rows={3}
        maxLength={160}
        placeholder={props.reasonPlaceholder}
        className="mt-1 w-full resize-none rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-action-primary-bg)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]"
        aria-label={props.reasonLabel}
        data-actor-name={props.actorName}
      />
    </OverlayShell>
  );
}
