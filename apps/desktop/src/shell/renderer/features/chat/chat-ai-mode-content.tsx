import { useCallback, useEffect, useMemo } from 'react';
import {
  CanonicalConversationShell,
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useAiConversationModeHost } from './chat-ai-shell-adapter';
import { ChatNimiThreadListSheet } from './chat-ai-session-list-panel';
import { ChatSideSheet } from './chat-side-sheet';

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
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const nimiConversationSelection = useAppStore((state) => state.nimiConversationSelection);
  const setNimiConversationSelection = useAppStore((state) => state.setNimiConversationSelection);
  const lastSelectedAiThread = useAppStore((state) => state.lastSelectedThreadByMode.ai ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.ai ?? null);

  const { host } = useAiConversationModeHost({
    runtimeConfigState: null,
    runtimeFields,
    selection: nimiConversationSelection,
    lastSelectedThreadId: lastSelectedAiThread,
    setSelection: setNimiConversationSelection,
  });

  // Sync setupState to store
  useEffect(() => {
    setChatSetupState('ai', host.adapter.setupState);
  }, [host.adapter.setupState, setChatSetupState]);

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

  const currentViewModeKey = selectedTarget
    ? `${selectedTarget.source}:${selectedTarget.id}`
    : 'ai:landing';
  const currentViewMode = useAppStore((state) => state.viewModeBySourceTarget[currentViewModeKey] || 'chat');

  const canonicalMessages = host.messages || [];

  const threadSummaries = useMemo(() => {
    const summaries = host.adapter.threadAdapter.listThreads();
    return Array.isArray(summaries) ? summaries : [];
  }, [host.adapter.threadAdapter]);

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!selectedTarget) {
      return;
    }
    setChatViewMode('ai', selectedTarget.id, mode);
  }, [selectedTarget, setChatViewMode]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <CanonicalConversationShell
        className="min-h-0 flex-1"
        chrome="transparent"
        hideTargetPane
        hideCharacterRail
        sourceFilter="all"
        targets={allTargets}
        selectedTargetId={selectedTargetId}
        selectedTarget={selectedTarget}
        onSelectTarget={onSelectTarget}
        viewMode={currentViewMode}
        onViewModeChange={handleViewModeChange}
        setupState={host.adapter.setupState}
        setupDescription={host.setupDescription}
        onSetupAction={onSetupAction}
        characterData={host.characterData}
        messages={canonicalMessages}
        transcriptProps={host.transcriptProps}
        stagePanelProps={host.stagePanelProps}
        topContent={host.topContent}
        composer={host.composerContent}
        auxiliaryOverlayContent={host.auxiliaryOverlayContent}
      />
      {selectedTarget && threadListOpen ? (
        <ChatNimiThreadListSheet
          threads={threadSummaries}
          activeThreadId={host.activeThreadId}
          onSelectThread={(threadId) => {
            host.onSelectThread?.(threadId);
            onCloseThreadList();
          }}
          onCreateThread={host.onCreateThread ? () => void host.onCreateThread!() : undefined}
          onArchiveThread={host.onArchiveThread ? (id) => void host.onArchiveThread!(id) : undefined}
          onRenameThread={host.onRenameThread}
          onClose={onCloseThreadList}
          title={host.characterData?.name || selectedTarget.title}
          subtitle={host.characterData?.handle || selectedTarget.handle}
          description={host.characterData?.bio || selectedTarget.bio}
        />
      ) : null}
      {selectedTarget && settingsOpen && host.settingsContent ? (
        <ChatSideSheet
          sheetKey="settings"
          title={host.characterData?.name || selectedTarget.title}
          subtitle={host.settingsDrawerSubtitle || t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' })}
          onClose={onCloseSettings}
        >
          <div className="px-3 py-3">
            {host.settingsContent}
          </div>
        </ChatSideSheet>
      ) : null}
    </div>
  );
}
