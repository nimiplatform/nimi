import { i18n } from '@renderer/i18n';

type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  pendingLabel: string;
  confirmLabel: string;
  confirmClassName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function ConfirmModal(props: ConfirmModalProps) {
  if (!props.isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={props.onClose}
      />
      <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="mb-2 text-lg font-semibold text-gray-900">{props.title}</h3>
        <p className="mb-6 text-sm text-gray-500">{props.message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={props.onClose}
            className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
          >
            {i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.pending}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${props.confirmClassName}`}
          >
            {props.pending ? props.pendingLabel : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BlockUserConfirmModal({
  isOpen,
  authorName,
  pending,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  authorName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title={i18n.t('Home.blockUser', { defaultValue: 'Block User' })}
      message={i18n.t('Home.blockUserMessage', {
        defaultValue: "Are you sure you want to block {{name}}? You won't see their posts anymore.",
        name: authorName,
      })}
      pendingLabel={i18n.t('Home.blocking', { defaultValue: 'Blocking...' })}
      confirmLabel={i18n.t('Home.block', { defaultValue: 'Block' })}
      confirmClassName="bg-red-500 hover:bg-red-600"
      pending={pending}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

export function DeletePostConfirmModal({
  isOpen,
  pending,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title={i18n.t('Home.deletePost', { defaultValue: 'Delete Post' })}
      message={i18n.t('Home.deletePostMessage', {
        defaultValue: 'Are you sure you want to delete this post? This action cannot be undone.',
      })}
      pendingLabel={i18n.t('Home.deleting', { defaultValue: 'Deleting...' })}
      confirmLabel={i18n.t('Home.delete', { defaultValue: 'Delete' })}
      confirmClassName="bg-red-500 hover:bg-red-600"
      pending={pending}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
