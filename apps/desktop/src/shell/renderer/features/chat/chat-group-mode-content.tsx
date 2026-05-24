import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CanonicalConversationShell } from '@nimiplatform/kit/features/chat/components/canonical-conversation-shell';
import {
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useGroupConversationModeHost } from './chat-group-adapter';
import {
  useGroupCanonicalStagePanelProps,
  useGroupCanonicalTranscriptProps,
} from './chat-group-canonical-components';
import { ChatSideSheet } from './chat-shared-side-sheet';

export type ChatGroupModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatGroupModeContent({
  allTargets,
  settingsOpen,
  onCloseSettings,
  onSetupAction,
  onSelectTarget,
}: ChatGroupModeContentProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUserId = useAppStore((state) => {
    const user = state.auth.user;
    return user ? String((user as Record<string, unknown>).id || (user as Record<string, unknown>).accountId || '') : null;
  });
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const lastSelectedGroupThread = useAppStore((state) => state.lastSelectedThreadByMode.group ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.group ?? null);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);

  const host = useGroupConversationModeHost({
    authStatus,
    currentUserId,
  });

  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current || allTargets.length === 0) {
      return;
    }
    if (storeSelectedTargetId || !lastSelectedGroupThread) {
      restoreAttemptedRef.current = true;
      return;
    }
    const targetExists = allTargets.some((target) => target.id === lastSelectedGroupThread && target.source === 'group');
    restoreAttemptedRef.current = true;
    if (!targetExists) {
      return;
    }
    setSelectedTargetForSource('group', lastSelectedGroupThread);
  }, [
    allTargets,
    lastSelectedGroupThread,
    setSelectedTargetForSource,
    storeSelectedTargetId,
  ]);

  // Sync setupState to store
  useEffect(() => {
    setChatSetupState('group', host.adapter.setupState);
  }, [host.adapter.setupState, setChatSetupState]);

  const selectedTargetId = storeSelectedTargetId;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );

  const currentViewModeKey = selectedTarget
    ? `${selectedTarget.source}:${selectedTarget.id}`
    : 'group:landing';
  const currentViewMode = useAppStore((state) => state.viewModeBySourceTarget[currentViewModeKey] || 'chat');

  const canonicalMessages = host.messages || [];
  const transcriptProps = useGroupCanonicalTranscriptProps();
  const stagePanelProps = useGroupCanonicalStagePanelProps();

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!selectedTarget) return;
    setChatViewMode('group', selectedTarget.id, mode);
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
        transcriptProps={transcriptProps}
        stagePanelProps={stagePanelProps}
        topContent={host.topContent}
        composer={host.composerContent}
        auxiliaryOverlayContent={host.auxiliaryOverlayContent}
      />
      {selectedTarget && settingsOpen ? (
        <ChatSideSheet
          sheetKey="settings"
          title={host.settingsDrawerTitle || 'Group'}
          subtitle={host.characterData?.bio || selectedTarget.title}
          onClose={onCloseSettings}
        >
          <div className="px-3 py-3">
            {host.rightPanelContent ?? (
              <p className="text-sm text-slate-500">
                Group settings are not available for this conversation yet.
              </p>
            )}
          </div>
        </ChatSideSheet>
      ) : null}
    </div>
  );
}
