import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { ConfirmDialog } from '@nimiplatform/kit/ui';


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
  const i18n = useDesktopI18nResource().instance;
  return (
    <ConfirmDialog
      open={isOpen}
      title={i18n.t('Home.blockUser', { defaultValue: 'Block User' })}
      message={i18n.t('Home.blockUserMessage', {
        defaultValue: "Are you sure you want to block {{name}}? You won't see their posts anymore.",
        name: authorName,
      })}
      confirmLabel={i18n.t('Home.block', { defaultValue: 'Block' })}
      cancelLabel={i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
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
  const i18n = useDesktopI18nResource().instance;
  return (
    <ConfirmDialog
      open={isOpen}
      title={i18n.t('Home.deletePost', { defaultValue: 'Delete Post' })}
      message={i18n.t('Home.deletePostMessage', {
        defaultValue: 'Are you sure you want to delete this post? This action cannot be undone.',
      })}
      confirmLabel={i18n.t('Home.delete', { defaultValue: 'Delete' })}
      cancelLabel={i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
      confirmTone="danger"
      pending={pending}
      pendingLabel={i18n.t('Home.deleting', { defaultValue: 'Deleting...' })}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
