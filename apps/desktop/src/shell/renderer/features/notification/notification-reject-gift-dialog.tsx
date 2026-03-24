import { Button } from '@renderer/components/action.js';
import { OverlayShell } from '@renderer/components/overlay.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

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
      title={<h2 className="text-lg font-bold text-gray-900">{props.title}</h2>}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button tone="secondary" onClick={props.onCancel} disabled={props.pending}>
            {props.cancelLabel}
          </Button>
          <Button tone="primary" onClick={props.onSubmit} disabled={props.pending} className="bg-red-500 hover:bg-red-600">
            {props.pending ? props.pendingLabel : props.confirmLabel}
          </Button>
        </div>
      )}
      dataTestId={E2E_IDS.notificationRejectGiftDialog}
      panelClassName="w-full max-w-md"
    >
      <p className="text-sm text-gray-600">{props.description}</p>
      <label className="mt-4 block text-xs font-medium text-gray-600" htmlFor="gift-reject-reason">
        {props.reasonLabel}
      </label>
      <textarea
        id="gift-reject-reason"
        value={props.rejectReason}
        onChange={(event) => props.onReasonChange(event.target.value)}
        rows={3}
        maxLength={160}
        placeholder={props.reasonPlaceholder}
        className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none focus:border-mint-300 focus:ring-2 focus:ring-mint-100"
        aria-label={props.reasonLabel}
        data-actor-name={props.actorName}
      />
    </OverlayShell>
  );
}
