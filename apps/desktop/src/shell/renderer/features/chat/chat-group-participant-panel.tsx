import { useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;

type AgentFromSnapshot = {
  agentId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
};

function toAgentListFromSocialSnapshot(
  snapshot: { friends?: unknown[] } | null | undefined,
): AgentFromSnapshot[] {
  const friends = Array.isArray(snapshot?.friends) ? snapshot.friends : [];
  return friends
    .filter((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && (item as Record<string, unknown>).isAgent === true,
    )
    .map((item) => ({
      agentId: String(item.accountId || item.id || ''),
      displayName: String(item.displayName || item.name || '').trim(),
      handle: String(item.handle || '').trim(),
      avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    }))
    .filter((a) => a.agentId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function toPanelErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (Array.isArray(record.message)) {
      const merged = record.message.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' ');
      if (merged) return merged;
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
  }
  return fallback;
}

export function ChatGroupParticipantPanel(props: {
  participants: readonly GroupParticipantDto[];
  currentUserId: string | null;
  chatId?: string | null;
  onAgentSlotChanged?: () => void;
}) {
  const { participants, currentUserId, chatId, onAgentSlotChanged } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const humans = participants.filter((p) => p.type === 'human');
  const agents = participants.filter((p) => p.type === 'agent');
  const existingAgentIds = new Set(agents.map((a) => String(a.accountId || '')));

  const socialQuery = useQuery({
    queryKey: ['social-snapshot-for-group-agents'],
    queryFn: async () => dataSync.loadSocialSnapshot(),
    enabled: addAgentOpen,
    staleTime: 30_000,
  });

  const availableAgents = toAgentListFromSocialSnapshot(
    socialQuery.data as { friends?: unknown[] } | null,
  ).filter((a) => !existingAgentIds.has(a.agentId));

  const handleAddAgent = async (agentAccountId: string) => {
    if (!chatId || pendingAction) return;
    setPendingAction(agentAccountId);
    setPanelError(null);
    try {
      await dataSync.addGroupAgent(chatId, agentAccountId);
      void queryClient.invalidateQueries({ queryKey: ['group-chats'] });
      onAgentSlotChanged?.();
      setAddAgentOpen(false);
    } catch (error) {
      setPanelError(toPanelErrorMessage(
        error,
        t('Chat.groupAddAgentError', { defaultValue: 'Failed to add agent to the group' }),
      ));
      logRendererEvent({
        level: 'warn',
        area: 'group-agent-slot',
        message: `add-error: ${error instanceof Error ? error.message : String(error)}`,
        details: { chatId, agentAccountId },
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleRemoveAgent = async (agentAccountId: string) => {
    if (!chatId || pendingAction) return;
    setPendingAction(agentAccountId);
    setPanelError(null);
    try {
      await dataSync.removeGroupAgent(chatId, agentAccountId);
      void queryClient.invalidateQueries({ queryKey: ['group-chats'] });
      onAgentSlotChanged?.();
    } catch (error) {
      setPanelError(toPanelErrorMessage(
        error,
        t('Chat.groupRemoveAgentError', { defaultValue: 'Failed to remove agent from the group' }),
      ));
      logRendererEvent({
        level: 'warn',
        area: 'group-agent-slot',
        message: `remove-error: ${error instanceof Error ? error.message : String(error)}`,
        details: { chatId, agentAccountId },
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="flex h-full flex-col border-l border-slate-200/60 bg-white/80">
      <div className="border-b border-slate-200/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">
          {t('Chat.groupParticipants', { defaultValue: 'Participants' })}
          <span className="ml-1.5 text-xs font-normal text-slate-400">
            {humans.length}
          </span>
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {humans.length > 0 && (
          <div className="mb-3">
            <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              {t('Chat.groupHumans', { defaultValue: 'Members' })}
            </div>
            {humans.map((p) => (
              <ParticipantRow
                key={p.accountId}
                participant={p}
                isCurrentUser={p.accountId === currentUserId}
              />
            ))}
          </div>
        )}
        <div>
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              {t('Chat.groupAgents', { defaultValue: 'Agents' })}
            </span>
            {chatId && (
              <button
                type="button"
                onClick={() => {
                  setPanelError(null);
                  setAddAgentOpen(!addAgentOpen);
                }}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-violet-600 hover:bg-violet-50"
              >
                {addAgentOpen
                  ? t('Common.cancel', { defaultValue: 'Cancel' })
                  : t('Chat.groupAddAgent', { defaultValue: '+ Add Agent' })}
              </button>
            )}
          </div>
          {panelError ? (
            <div className="px-2 pb-2 text-xs text-rose-500">
              {panelError}
            </div>
          ) : null}
          {agents.map((p) => (
            <ParticipantRow
              key={p.accountId}
              participant={p}
              isCurrentUser={false}
              canRemove={p.agentOwnerId === currentUserId}
              onRemove={() => handleRemoveAgent(String(p.accountId || ''))}
              isPending={pendingAction === p.accountId}
            />
          ))}
          {agents.length === 0 && !addAgentOpen && (
            <div className="px-2 py-2 text-xs text-slate-400">
              {t('Chat.groupNoAgents', { defaultValue: 'No agents in this group' })}
            </div>
          )}
          {addAgentOpen && (
            <div className="mt-1 rounded-lg border border-violet-200/60 bg-violet-50/50 p-2">
              {availableAgents.length > 0 ? (
                availableAgents.map((agent) => (
                  <button
                    key={agent.agentId}
                    type="button"
                    onClick={() => handleAddAgent(agent.agentId)}
                    disabled={pendingAction !== null}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-violet-100/60 disabled:opacity-50"
                  >
                    {agent.avatarUrl ? (
                      <img src={agent.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-200 text-[10px] font-medium text-violet-700">
                        {(agent.displayName || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="truncate text-sm text-slate-700">{agent.displayName || agent.handle}</span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-1.5 text-xs text-slate-400">
                  {socialQuery.isLoading
                    ? t('Common.loading', { defaultValue: 'Loading...' })
                    : t('Chat.groupNoAvailableAgents', { defaultValue: 'No agents available to add' })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ParticipantRow(props: {
  participant: GroupParticipantDto;
  isCurrentUser: boolean;
  canRemove?: boolean;
  onRemove?: () => void;
  isPending?: boolean;
}) {
  const { participant, isCurrentUser, canRemove, onRemove, isPending } = props;
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
        <div className={[
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium',
          participant.type === 'agent'
            ? 'bg-violet-100 text-violet-600'
            : 'bg-slate-100 text-slate-500',
        ].join(' ')}>
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
          {participant.type === 'agent' && (
            <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-600">
              {t('Chat.groupAgent', { defaultValue: 'Agent' })}
            </span>
          )}
        </div>
        {participant.handle && (
          <div className="truncate text-xs text-slate-400">@{participant.handle}</div>
        )}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={isPending}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
          title={t('Chat.groupRemoveAgent', { defaultValue: 'Remove agent' })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  );
}
