import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';
import { useTranslation } from 'react-i18next';
import { HumanIdentityPreview } from '../relationship/human-identity-preview.js';
import { RelationshipActionsMenu } from '../relationship/relationship-actions-menu.js';
import { useHumanProfileActions } from '../relationship/use-human-profile-actions.js';
import type { HumanContactAdmission } from './chat-human-contact-admission.js';
import { E2E_IDS } from '../../testability/e2e-ids.js';

export function HumanChatHeader({ peer, admission }: { peer: RealmChatViewDto['otherUser']; admission: HumanContactAdmission }) {
  const { t } = useTranslation();
  const actions = useHumanProfileActions(admission.deleted ? null : {
    id: peer.id, displayName: peer.displayName || peer.handle,
    relationshipId: admission.relationship?.relationshipId, relationship: admission.relationship,
  });
  return <header className="flex min-w-0 items-center justify-between gap-3 pr-14">
    <HumanIdentityPreview {...peer} displayName={peer.displayName || peer.handle} avatarUrl={peer.avatarUrl ?? null} disabled={admission.deleted}
      triggerTestId={E2E_IDS.chatHeaderProfileToggle} openProfileTestId={E2E_IDS.chatOpenUserProfile} />
    <RelationshipActionsMenu label={t('Relationship.contacts.personActions', { name: peer.displayName || peer.handle })} disabled={actions.props.actionsPending || admission.deleted} items={[
      ...(actions.props.onRemove ? [{ id: 'remove', label: t('Profile.removeFriend'), onSelect: actions.props.onRemove }] : []),
      ...(actions.props.onBlock ? [{ id: 'block', label: t('Profile.blockUser'), onSelect: actions.props.onBlock }] : []),
      ...(actions.props.onUnblock ? [{ id: 'unblock', label: t('Profile.unblock'), onSelect: actions.props.onUnblock }] : []),
      ...(actions.props.onReport ? [{ id: 'report', label: t('Relationship.report.action'), onSelect: actions.props.onReport }] : []),
    ]} />
    {actions.dialog}
  </header>;
}
