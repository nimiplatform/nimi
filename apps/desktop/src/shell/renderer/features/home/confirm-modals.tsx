import { ConfirmDialog } from '@nimiplatform/nimi-kit/ui';
import { i18n } from '@renderer/i18n';

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
    <ConfirmDialog
      open={isOpen}
      title={i18n.t('Home.blockUser', { defaultValue: 'Block User' })}
      message={i18n.t('Home.blockUserMessage', {
        defaultValue: "Are you sure you want to block {{name}}? You won't see their posts anymore.",
        name: authorName,
      })}
      confirmLabel={i18n.t('Home.block', { defaultValue: 'Block' })}
      cancelLabel={i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
      confirmTone="danger"
      pending={pending}
      pendingLabel={i18n.t('Home.blocking', { defaultValue: 'Blocking...' })}
      onConfirm={onConfirm}
      onClose={onClose}
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
    <ConfirmDialog
      open={isOpen}
      title={i18n.t('Home.deletePost', { defaultValue: 'Delete Post' })}
      message={i18n.t('Home.deletePostMessage', {
        defaultValue: 'Are you sure you want to delete this post? This action cannot be undone.',
      })}
      confirmLabel={i18n.t('Home.delete', { defaultValue: 'Delete' })}
      cancelLabel={i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
      confirmTone="danger"
      pending={pending}
      pendingLabel={i18n.t('Home.deleting', { defaultValue: 'Deleting...' })}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
