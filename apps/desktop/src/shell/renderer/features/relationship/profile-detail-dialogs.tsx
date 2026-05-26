import { Button } from '@nimiplatform/kit/ui';
import { i18n } from '@renderer/i18n';
import { OverlayShell } from '@renderer/components/overlay/index.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

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
  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={pending ? undefined : onCancel}
      dataTestId={E2E_IDS.profileRemoveFriendConfirmDialog}
      title={<h3 className="text-lg font-semibold text-gray-900">{i18n.t('Profile.removeFriend', { defaultValue: 'Remove Friend' })}</h3>}
      footer={(
        <div className="flex justify-end gap-3">
          <Button tone="ghost" onClick={onCancel} disabled={pending}>
            {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button tone="secondary" onClick={onConfirm} disabled={pending} className="bg-red-600 text-white hover:bg-red-700 hover:text-white">
            {pending
              ? i18n.t('Profile.removing', { defaultValue: 'Removing...' })
              : i18n.t('Profile.removeFriend', { defaultValue: 'Remove Friend' })}
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
