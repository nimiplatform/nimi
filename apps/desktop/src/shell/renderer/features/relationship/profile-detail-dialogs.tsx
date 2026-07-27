import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';

import { E2E_IDS } from '../../testability/e2e-ids';

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
    <OverlayShell
      open
      kind="dialog"
      onClose={confirmationState.canDismiss ? onCancel : undefined}
      dataTestId={E2E_IDS.profileRemoveFriendConfirmDialog}
      title={<h3 className="text-lg font-semibold text-gray-900">{i18n.t('Profile.removeFriend', { defaultValue: 'Remove Friend' })}</h3>}
      footer={(
        <div className="flex justify-end gap-3">
          <Button tone="ghost" onClick={onCancel} disabled={confirmationState.actionsDisabled}>
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button tone="secondary" onClick={onConfirm} disabled={confirmationState.actionsDisabled} className="bg-red-600 text-white hover:bg-red-700 hover:text-white">
            {i18n.t(confirmationState.confirmLabelKey, {
              defaultValue: confirmationState.confirmLabelDefaultValue,
            })}
          </Button>
        </div>
      )}
    >
      <p className="text-sm text-gray-500">
        {i18n.t('Relationship.removeFriendConfirmMessagePrefix', { defaultValue: 'Remove' })}{' '}
        <span className="font-medium text-gray-700">{contact.displayName}</span>
        ? {i18n.t('Relationship.removeFriendConfirmMessageSuffix', { defaultValue: 'This will remove them from your friends list.' })}
      </p>
    </OverlayShell>
  );
}
