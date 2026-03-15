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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-gray-900">{props.title}</h2>
        <p className="mt-2 text-sm text-gray-600">{props.description}</p>
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
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.pending}
            className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {props.cancelLabel}
          </button>
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={props.pending}
            className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {props.pending ? props.pendingLabel : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
