import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;

export function ChatGroupParticipantPanel(props: {
  participants: readonly GroupParticipantDto[];
  currentUserId: string | null;
  embedded?: boolean;
}) {
  const { participants, currentUserId, embedded = false } = props;
  const { t } = useTranslation();

  return (
    <div className={embedded ? 'flex h-full flex-col bg-transparent' : 'flex h-full flex-col border-l border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)]'}>
      <div className={embedded ? 'px-1 pb-3' : 'border-b border-[var(--nimi-border-subtle)] px-4 py-3'}>
        <h3 className="text-sm font-semibold text-[var(--nimi-text-secondary)]">
          {t('Chat.groupParticipants', { defaultValue: 'Participants' })}
          <span className="ml-1.5 text-xs font-normal text-[var(--nimi-text-muted)]">
            {participants.length}
          </span>
        </h3>
      </div>
      <ScrollArea className="flex-1" viewportClassName={embedded ? 'px-0 py-0' : 'px-2 py-2'}>
        {participants.map((participant) => (
          <ParticipantRow
            key={participant.accountId}
            participant={participant}
            isCurrentUser={participant.accountId === currentUserId}
          />
        ))}
      </ScrollArea>
    </div>
  );
}

function ParticipantRow(props: {
  participant: GroupParticipantDto;
  isCurrentUser: boolean;
}) {
  const { participant, isCurrentUser } = props;
  const { t } = useTranslation();
  const displayName = String(participant.displayName || '').trim()
    || String(participant.handle || '').trim()
    || t('Common.unknown', { defaultValue: 'Unknown' });

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--nimi-action-ghost-hover)]">
      <EntityAvatar
        imageUrl={participant.avatarUrl}
        name={displayName}
        kind="human"
        sizeClassName="h-7 w-7"
        textClassName="text-xs font-medium"
        fallbackClassName="bg-[var(--nimi-surface-panel)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-[var(--nimi-text-secondary)]">{displayName}</span>
          {isCurrentUser && (
            <span className="shrink-0 text-[10px] text-[var(--nimi-text-muted)]">
              ({t('Chat.groupYou', { defaultValue: 'you' })})
            </span>
          )}
          {participant.role === 'admin' && (
            <span className="shrink-0 rounded bg-[var(--nimi-status-warning-soft-bg)] px-1 py-0.5 text-[10px] font-medium text-[var(--nimi-status-warning-soft-text)]">
              {t('Chat.groupAdmin', { defaultValue: 'Admin' })}
            </span>
          )}
        </div>
        {participant.handle && (
          <div className="truncate text-xs text-[var(--nimi-text-muted)]">@{participant.handle}</div>
        )}
      </div>
    </div>
  );
}
