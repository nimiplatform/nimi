import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  CanonicalConversationShell,
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useHumanConversationModeHost } from './chat-human-adapter';
import { ChatSideSheet } from './chat-side-sheet';

export type ChatHumanModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatHumanModeContent({
  allTargets,
  settingsOpen,
  onCloseSettings,
  onSetupAction,
  onSelectTarget,
}: ChatHumanModeContentProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setChatProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const lastSelectedHumanThread = useAppStore((state) => state.lastSelectedThreadByMode.human ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.human ?? null);

  const host = useHumanConversationModeHost({
    authStatus,
    selectedChatId,
    setSelectedChatId,
    setChatProfilePanelTarget,
  });

  // Bridge sidebar target selection to host
  const prevTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (storeSelectedTargetId && storeSelectedTargetId !== prevTargetIdRef.current) {
      host.onSelectTarget?.(storeSelectedTargetId);
    }
    prevTargetIdRef.current = storeSelectedTargetId;
  }, [host, storeSelectedTargetId]);

  // Restore lastSelectedHumanThread on mount
  useEffect(() => {
    if (selectedChatId || !lastSelectedHumanThread) {
      return;
    }
    setSelectedChatId(lastSelectedHumanThread);
  }, [lastSelectedHumanThread, selectedChatId, setSelectedChatId]);

  // Sync setupState to store
  useEffect(() => {
    setChatSetupState('human', host.adapter.setupState);
  }, [host.adapter.setupState, setChatSetupState]);

  // Sync host selectedTargetId to store
  useEffect(() => {
    if (!host.selectedTargetId || storeSelectedTargetId) {
      return;
    }
    setSelectedTargetForSource('human', host.selectedTargetId);
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
    : 'human:landing';
  const currentViewMode = useAppStore((state) => state.viewModeBySourceTarget[currentViewModeKey] || 'chat');

  const canonicalMessages = host.messages || [];

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!selectedTarget) {
      return;
    }
    setChatViewMode('human', selectedTarget.id, mode);
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
      {selectedTarget && settingsOpen && host.settingsContent ? (
        <ChatSideSheet
          sheetKey="settings"
          title={host.settingsDrawerTitle || 'Settings'}
          subtitle={host.settingsDrawerSubtitle || host.characterData?.name || selectedTarget.title}
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
