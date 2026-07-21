import { useEffect, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { useQueryClient } from '@tanstack/react-query';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  characterSourceRefKey,
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../realm-source/realm-source-identity.js';
import {
  fetchLocalAgentList,
  type LocalAgentListItem,
} from '../agents/local-agent-list-model.js';
import type { GroupSourceParticipantInput } from './data/realm-group-chat-data';
import { useRealmGroupChatData } from './data/realm-group-chat-data-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
type SourceFromSnapshot = {
  sourceKey: string;
  ownerUserId: string;
  sourceRef: CharacterSourceRefV3;
  input: GroupSourceParticipantInput;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toSourceFromRuntimeAgent(agent: LocalAgentListItem, currentUserId: string): SourceFromSnapshot | null {
  const ownerUserId = normalizeText(agent.ownerUserId);
  if (ownerUserId !== currentUserId) return null;
  const sourceRef = agent.sourceRef;
  const sourceKey = characterSourceRefKey(sourceRef);
  const displayName = normalizeText(agent.displayName) || sourceRef.id;
  return {
    sourceKey,
    ownerUserId,
    sourceRef,
    input: { sourceRef },
    displayName,
    handle: sourceRef.id,
    avatarUrl: null,
  };
}

function sourceParticipantKey(participant: GroupParticipantDto): string {
  const sourceRef = readCharacterSourceRefV3(participant.sourceRef);
  if (sourceRef) return characterSourceRefKey(sourceRef);
  return normalizeText(participant.runtimeSourceRef) || normalizeText(participant.runtimeParticipantSlot);
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
  onSourceSlotChanged?: () => void;
  embedded?: boolean;
}) {
  const { participants, currentUserId, chatId, onSourceSlotChanged, embedded = false } = props;
  const realmGroupChatData = useRealmGroupChatData();
  const bindings = useDesktopRendererBindings();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [runtimeSources, setRuntimeSources] = useState<SourceFromSnapshot[]>([]);
  const [sourcePickerLoading, setSourcePickerLoading] = useState(false);

  const humans = participants.filter((p) => p.type === 'human');
  const sources = participants.filter((p) => p.type === 'source');
  const existingSourceKeys = new Set(
    sources
      .map(sourceParticipantKey)
      .filter(Boolean),
  );
  const canManageSourceSlots = Boolean(
    currentUserId
    && humans.some((p) => p.accountId === currentUserId && p.role === 'admin'),
  );
  const showAddSourcePicker = addSourceOpen && canManageSourceSlots;

  useEffect(() => {
    if (addSourceOpen && !canManageSourceSlots) {
      setAddSourceOpen(false);
    }
  }, [addSourceOpen, canManageSourceSlots]);

  useEffect(() => {
    let cancelled = false;
    if (!showAddSourcePicker || !currentUserId) {
      setRuntimeSources([]);
      setSourcePickerLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setSourcePickerLoading(true);
    void fetchLocalAgentList(currentUserId, bindings.sdk).then((agents) => {
      if (cancelled) return;
      setRuntimeSources(agents
        .map((agent) => toSourceFromRuntimeAgent(agent, currentUserId))
        .filter((source): source is SourceFromSnapshot => Boolean(source)));
    }).catch((error) => {
      if (cancelled) return;
      setRuntimeSources([]);
      setPanelError(toPanelErrorMessage(
        error,
        t('Chat.groupLoadSourcesError', { defaultValue: 'Failed to load local sources.' }),
      ));
      logRendererEvent({
        level: 'warn',
        area: 'runtime-participant-slot',
        message: `load-sources-error: ${error instanceof Error ? error.message : String(error)}`,
        details: { chatId: chatId || null },
      });
    }).finally(() => {
      if (!cancelled) {
        setSourcePickerLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bindings, chatId, currentUserId, showAddSourcePicker, t]);

  const availableSources = runtimeSources.filter((source) =>
    source.ownerUserId === currentUserId
    && !existingSourceKeys.has(source.sourceKey),
  );

  const handleAddSource = async (source: SourceFromSnapshot) => {
    if (!chatId || pendingAction) return;
    if (!canManageSourceSlots) {
      setPanelError(t('Chat.groupSourceSlotManagementDenied', { defaultValue: 'Only group admins can manage sources.' }));
      return;
    }
    setPendingAction(source.sourceKey);
    setPanelError(null);
    try {
      await realmGroupChatData.addGroupSource(chatId, source.input);
      void queryClient.invalidateQueries({ queryKey: ['group-chats'] });
      onSourceSlotChanged?.();
      setAddSourceOpen(false);
    } catch (error) {
      setPanelError(toPanelErrorMessage(
        error,
        t('Chat.groupAddSourceError', { defaultValue: 'Failed to add source to the group' }),
      ));
      logRendererEvent({
        level: 'warn',
        area: 'runtime-participant-slot',
        message: `add-error: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          chatId,
          runtimeSourceRef: source.sourceKey,
          sourceId: source.sourceRef.id,
        },
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleRemoveSource = async (runtimeParticipantSlot: string) => {
    if (!chatId || pendingAction) return;
    if (!canManageSourceSlots) {
      setPanelError(t('Chat.groupSourceSlotManagementDenied', { defaultValue: 'Only group admins can manage sources.' }));
      return;
    }
    setPendingAction(runtimeParticipantSlot);
    setPanelError(null);
    try {
      await realmGroupChatData.removeGroupSource(chatId, runtimeParticipantSlot);
      void queryClient.invalidateQueries({ queryKey: ['group-chats'] });
      onSourceSlotChanged?.();
    } catch (error) {
      setPanelError(toPanelErrorMessage(
        error,
        t('Chat.groupRemoveSourceError', { defaultValue: 'Failed to remove source from the group' }),
      ));
      logRendererEvent({
        level: 'warn',
        area: 'runtime-participant-slot',
        message: `remove-error: ${error instanceof Error ? error.message : String(error)}`,
        details: { chatId, runtimeParticipantSlot },
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className={embedded ? 'flex h-full flex-col bg-transparent' : 'flex h-full flex-col border-l border-slate-200/60 bg-white/80'}>
      <div className={embedded ? 'px-1 pb-3' : 'border-b border-slate-200/60 px-4 py-3'}>
        <h3 className="text-sm font-semibold text-slate-700">
          {t('Chat.groupParticipants', { defaultValue: 'Participants' })}
          <span className="ml-1.5 text-xs font-normal text-slate-400">
            {humans.length}
          </span>
        </h3>
      </div>
      <ScrollArea className="flex-1" viewportClassName={embedded ? 'px-0 py-0' : 'px-2 py-2'}>
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
              {t('Chat.groupSources', { defaultValue: 'Sources' })}
            </span>
            {chatId && canManageSourceSlots && (
              <button
                type="button"
                onClick={() => {
                  setPanelError(null);
                  setAddSourceOpen(!addSourceOpen);
                }}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-violet-600 hover:bg-violet-50"
              >
                {addSourceOpen
                  ? t('Common.cancel', { defaultValue: 'Cancel' })
                  : t('Chat.groupAddSource', { defaultValue: '+ Add Source' })}
              </button>
            )}
          </div>
          {chatId && !canManageSourceSlots ? (
            <div
              className="px-2 pb-2 text-xs text-slate-400"
              data-chat-runtime-participant-slot-refusal="realm-role-required"
            >
              {t('Chat.groupSourceSlotManagementDenied', { defaultValue: 'Only group admins can manage sources.' })}
            </div>
          ) : null}
          {panelError ? (
            <div className="px-2 pb-2 text-xs text-rose-500">
              {panelError}
            </div>
          ) : null}
          {sources.map((p) => (
            <ParticipantRow
              key={p.accountId}
              participant={p}
              isCurrentUser={false}
              canRemove={canManageSourceSlots && Boolean(normalizeText(p.runtimeParticipantSlot))}
              onRemove={() => handleRemoveSource(normalizeText(p.runtimeParticipantSlot))}
              isPending={pendingAction === p.runtimeParticipantSlot}
            />
          ))}
          {sources.length === 0 && !addSourceOpen && (
            <div className="px-2 py-2 text-xs text-slate-400">
              {t('Chat.groupNoSources', { defaultValue: 'No sources in this group' })}
            </div>
          )}
          {showAddSourcePicker && (
            <div className="mt-1 rounded-lg border border-violet-200/60 bg-violet-50/50 p-2">
              {sourcePickerLoading ? (
                <div className="px-2 py-1.5 text-xs text-slate-400">
                  {t('Chat.groupLoadingSources', { defaultValue: 'Loading sources...' })}
                </div>
              ) : availableSources.length > 0 ? (
                availableSources.map((source) => (
                  <button
                    key={source.sourceKey}
                    type="button"
                    onClick={() => handleAddSource(source)}
                    disabled={pendingAction !== null}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-violet-100/60 disabled:opacity-50"
                  >
                    {source.avatarUrl ? (
                      <img src={source.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-200 text-[10px] font-medium text-violet-700">
                        {(source.displayName || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="truncate text-sm text-slate-700">{source.displayName || source.handle}</span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-1.5 text-xs text-slate-400">
                  {t('Chat.groupNoAvailableSources', { defaultValue: 'No local agents available to add' })}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
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
          participant.type === 'source'
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
          {participant.type === 'source' && (
            <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-600">
              {t('Chat.groupSource', { defaultValue: 'Source' })}
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
          title={t('Chat.groupRemoveSource', { defaultValue: 'Remove source' })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  );
}
