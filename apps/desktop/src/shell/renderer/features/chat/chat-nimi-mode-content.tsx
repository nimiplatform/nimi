import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useMemo } from 'react';
import { type ConversationSetupAction, type ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';

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
  const homeChat = useHomeChatPosition();
  const { t } = useTranslation();
  const nimiConversationSelection = homeChat.nimiSelection;
  const selectNimiThread = homeChat.selectNimiThread;
  const storeSelectedTargetId = homeChat.targetId;

  const { host } = useAiConversationModeHost({
    selection: nimiConversationSelection,
    lastSelectedThreadId: null,
    setSelection: selectNimiThread,
  });

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
          // Selecting a thread keeps the list open so people can hop between
          // conversations; only the close button (or leaving AI mode) dismisses it.
          onSelectThread={(threadId) => host.onSelectThread?.(threadId)}
          onCreateThread={host.onCreateThread ? () => void host.onCreateThread!() : undefined}
          onClose={onCloseThreadList}
          title={host.characterData?.name || selectedTarget.title}
          description={host.characterData?.bio || selectedTarget.bio}
        />
      ) : null}
    />
  );
}
