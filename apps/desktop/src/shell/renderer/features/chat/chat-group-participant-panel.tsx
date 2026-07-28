import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;

export function ChatGroupParticipantPanel(props: {
  participants: readonly GroupParticipantDto[];
  currentUserId: string | null;
  embedded?: boolean;
}) {
  const { participants, currentUserId, embedded = false } = props;
  const { t } = useTranslation();

  return (
    <div className={embedded ? 'flex h-full flex-col bg-transparent' : 'flex h-full flex-col border-l border-slate-200/60 bg-white/80'}>
      <div className={embedded ? 'px-1 pb-3' : 'border-b border-slate-200/60 px-4 py-3'}>
        <h3 className="text-sm font-semibold text-slate-700">
          {t('Chat.groupParticipants', { defaultValue: 'Participants' })}
          <span className="ml-1.5 text-xs font-normal text-slate-400">
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
    || 'Unknown';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
      {participant.avatarUrl ? (
        <img
          src={participant.avatarUrl}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-500">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-slate-700">{displayName}</span>
          {isCurrentUser && (
            <span className="shrink-0 text-[10px] text-slate-400">
              ({t('Chat.groupYou', { defaultValue: 'you' })})
            </span>
          )}
          {participant.role === 'admin' && (
            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
              {t('Chat.groupAdmin', { defaultValue: 'Admin' })}
            </span>
          )}
        </div>
        {participant.handle && (
          <div className="truncate text-xs text-slate-400">@{participant.handle}</div>
        )}
      </div>
    </div>
  );
}
