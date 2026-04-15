import { useCallback, useEffect, useMemo } from 'react';
import {
  CanonicalConversationShell,
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useAiConversationModeHost } from './chat-ai-shell-adapter';
import { ChatAiSessionListPanel } from './chat-ai-session-list-panel';
import { ChatRightPanelSettings } from './chat-right-panel-settings';

export type ChatAiModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  rightPanelMode: 'auto' | 'settings';
  rightPanelFolded: boolean;
  onToggleRightPanelFold: () => void;
  onToggleRightPanelSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatAiModeContent({
  allTargets,
  rightPanelMode,
  rightPanelFolded,
  onToggleRightPanelFold,
  onToggleRightPanelSettings,
  onSetupAction,
  onSelectTarget,
}: ChatAiModeContentProps) {
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const aiConversationSelection = useAppStore((state) => state.aiConversationSelection);
  const setAiConversationSelection = useAppStore((state) => state.setAiConversationSelection);
  const lastSelectedAiThread = useAppStore((state) => state.lastSelectedThreadByMode.ai ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.ai ?? null);

  const { host } = useAiConversationModeHost({
    runtimeConfigState: null,
    runtimeFields,
    selection: aiConversationSelection,
    lastSelectedThreadId: lastSelectedAiThread,
    setSelection: setAiConversationSelection,
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

  const rightPanelNode = useMemo(() => {
    if (!selectedTarget || rightPanelFolded) {
      return null;
    }
    if (rightPanelMode === 'settings') {
      return (
        <ChatRightPanelSettings onToggleSettings={onToggleRightPanelSettings} thinkingState={host.thinkingState} onThinkingToggle={host.onThinkingToggle}>
          {host.settingsContent ?? null}
        </ChatRightPanelSettings>
      );
    }
    const threadSummaries = host.adapter.threadAdapter.listThreads();
    const threads = Array.isArray(threadSummaries) ? threadSummaries : [];
    return (
      <ChatAiSessionListPanel
        threads={threads}
        activeThreadId={host.activeThreadId}
        onSelectThread={(threadId) => host.onSelectThread?.(threadId)}
        onCreateThread={host.onCreateThread ? () => void host.onCreateThread!() : undefined}
        onArchiveThread={host.onArchiveThread ? (id) => void host.onArchiveThread!(id) : undefined}
        onRenameThread={host.onRenameThread}
        onToggleSettings={onToggleRightPanelSettings}
        settingsActive={false}
        thinkingState={host.thinkingState}
        onThinkingToggle={host.onThinkingToggle}
        onToggleFold={onToggleRightPanelFold}
      />
    );
  }, [host, selectedTarget, rightPanelMode, rightPanelFolded, onToggleRightPanelSettings, onToggleRightPanelFold]);

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!selectedTarget) {
      return;
    }
    setChatViewMode('ai', selectedTarget.id, mode);
  }, [selectedTarget, setChatViewMode]);

  return (
    <CanonicalConversationShell
      className="min-h-0 flex-1"
      hideTargetPane
      hideCharacterRail
      rightPanel={rightPanelNode}
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
  );
}
