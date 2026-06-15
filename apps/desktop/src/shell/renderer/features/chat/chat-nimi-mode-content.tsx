import { useEffect, useMemo } from 'react';
import {
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useAiConversationModeHost } from './chat-nimi-shell-adapter';
import { ChatNimiThreadListSheet } from './chat-nimi-session-list-panel';
import { ChatCanonicalModeFrame } from './chat-canonical-mode-frame';

export type ChatNimiModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  settingsOpen: boolean;
  onCloseSettings: () => void;
  threadListOpen: boolean;
  onCloseThreadList: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatNimiModeContent({
  allTargets,
  settingsOpen,
  onCloseSettings,
  threadListOpen,
  onCloseThreadList,
  onSetupAction,
  onSelectTarget,
}: ChatNimiModeContentProps) {
  const { t } = useTranslation();
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const nimiConversationSelection = useAppStore((state) => state.nimiConversationSelection);
  const setNimiConversationSelection = useAppStore((state) => state.setNimiConversationSelection);
  const lastSelectedAiThread = useAppStore((state) => state.lastSelectedThreadByMode.ai ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.ai ?? null);

  const { host } = useAiConversationModeHost({
    selection: nimiConversationSelection,
    lastSelectedThreadId: lastSelectedAiThread,
    setSelection: setNimiConversationSelection,
  });

  // Sync host selectedTargetId to store
  useEffect(() => {
    if (!host.selectedTargetId || storeSelectedTargetId) {
      return;
    }
    setSelectedTargetForSource('ai', host.selectedTargetId);
  }, [host.selectedTargetId, setSelectedTargetForSource, storeSelectedTargetId]);

  const selectedTargetId = storeSelectedTargetId || host.selectedTargetId || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );

  const threadSummaries = useMemo(() => {
    const summaries = host.adapter.threadAdapter.listThreads();
    return Array.isArray(summaries) ? summaries : [];
  }, [host.adapter.threadAdapter]);

  return (
    <ChatCanonicalModeFrame
      mode="ai"
      host={host}
      allTargets={allTargets}
      selectedTargetId={selectedTargetId}
      selectedTarget={selectedTarget}
      onSelectTarget={onSelectTarget}
      onSetupAction={onSetupAction}
      settingsOpen={settingsOpen}
      onCloseSettings={onCloseSettings}
      settingsSheetTitle={selectedTarget ? (host.characterData?.name || selectedTarget.title) : undefined}
      settingsSheetSubtitle={host.settingsDrawerSubtitle || t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' })}
      afterShell={selectedTarget && threadListOpen ? (
        <ChatNimiThreadListSheet
          threads={threadSummaries}
          activeThreadId={host.activeThreadId}
          onSelectThread={(threadId) => {
            host.onSelectThread?.(threadId);
            onCloseThreadList();
          }}
          onCreateThread={host.onCreateThread ? () => void host.onCreateThread!() : undefined}
          onClose={onCloseThreadList}
          title={host.characterData?.name || selectedTarget.title}
          subtitle={host.characterData?.handle || selectedTarget.handle}
          description={host.characterData?.bio || selectedTarget.bio}
        />
      ) : null}
    />
  );
}
