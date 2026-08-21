import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { ConfirmDialog } from '@nimiplatform/kit/ui';

export function projectRemoveFriendConfirmationState(pending: boolean): {
  readonly actionsDisabled: boolean;
  readonly canDismiss: boolean;
  readonly confirmLabelKey: 'Profile.removing' | 'Profile.removeFriend';
  readonly confirmLabelDefaultValue: 'Removing...' | 'Remove Friend';
} {
  return {
    actionsDisabled: pending,
    canDismiss: !pending,
    confirmLabelKey: pending ? 'Profile.removing' : 'Profile.removeFriend',
    confirmLabelDefaultValue: pending ? 'Removing...' : 'Remove Friend',
  };
}

export function RemoveFriendConfirmDialog({
  contact,
  pending = false,
  onConfirm,
  onCancel,
}: {
  contact: { displayName: string };
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  const confirmationState = projectRemoveFriendConfirmationState(pending);
  return (
    <ConfirmDialog
      open
      title={i18n.t('Profile.removeFriend', { defaultValue: 'Remove Friend' })}
      message={(
        <>
          {i18n.t('Relationship.removeFriendConfirmMessagePrefix', { defaultValue: 'Remove' })}{' '}
          <span className="font-medium text-[var(--nimi-text-primary)]">{contact.displayName}</span>
          ? {i18n.t('Relationship.removeFriendConfirmMessageSuffix', { defaultValue: 'This will remove them from your friends list.' })}
        </>
      )}
      confirmLabel={i18n.t(confirmationState.confirmLabelKey, {
        defaultValue: confirmationState.confirmLabelDefaultValue,
      })}
      cancelLabel={i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
      confirmTone="danger"
      pending={confirmationState.actionsDisabled}
      pendingLabel={i18n.t('Profile.removing', { defaultValue: 'Removing...' })}
      onConfirm={onConfirm}
      onClose={() => {
        if (confirmationState.canDismiss) {
          onCancel();
        }
      }}
    />
  );
}

export function BlockUserConfirmDialog({
  contact,
  pending = false,
  onConfirm,
  onCancel,
}: {
  contact: { displayName: string };
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  return (
    <ConfirmDialog
      open
      title={i18n.t('Profile.blockUser', { defaultValue: 'Block User' })}
      message={i18n.t('Relationship.blockUserConfirmMessage', {
        name: contact.displayName,
        defaultValue: "Block {{name}}? They will be moved to your Blocked list and won't be able to contact you.",
      })}
      confirmLabel={i18n.t('Profile.blockUser', { defaultValue: 'Block User' })}
      cancelLabel={i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
      confirmTone="danger"
      pending={pending}
      pendingLabel={i18n.t('Profile.blocking', { defaultValue: 'Blocking...' })}
      onConfirm={onConfirm}
      onClose={() => {
        if (!pending) {
          onCancel();
        }
      }}
    />
  );
}
