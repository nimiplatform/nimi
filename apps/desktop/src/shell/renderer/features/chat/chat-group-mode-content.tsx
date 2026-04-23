import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  CanonicalConversationShell,
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useGroupConversationModeHost } from './chat-group-adapter';
import { GROUP_CREATE_INTENT_TARGET_ID } from './chat-group-flow-constants';
import {
  useGroupCanonicalStagePanelProps,
  useGroupCanonicalTranscriptProps,
} from './chat-group-canonical-components';
import { ChatSideSheet } from './chat-side-sheet';

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
  const normalizedStoreSelectedTargetId = storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID
    ? null
    : storeSelectedTargetId;

  const host = useGroupConversationModeHost({
    authStatus,
    currentUserId,
  });

  const prevTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousTargetId = prevTargetIdRef.current;

    if (
      storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID
      && previousTargetId !== GROUP_CREATE_INTENT_TARGET_ID
    ) {
      setSelectedTargetForSource('group', null);
      void host.onCreateThread?.();
    }

    prevTargetIdRef.current = storeSelectedTargetId;
  }, [host.onCreateThread, setSelectedTargetForSource, storeSelectedTargetId]);

  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current || allTargets.length === 0) {
      return;
    }
    if (
      storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID
      || normalizedStoreSelectedTargetId
      || !lastSelectedGroupThread
    ) {
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
    normalizedStoreSelectedTargetId,
    setSelectedTargetForSource,
    storeSelectedTargetId,
  ]);

  // Sync setupState to store
  useEffect(() => {
    setChatSetupState('group', host.adapter.setupState);
  }, [host.adapter.setupState, setChatSetupState]);

  const selectedTargetId = normalizedStoreSelectedTargetId;
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
