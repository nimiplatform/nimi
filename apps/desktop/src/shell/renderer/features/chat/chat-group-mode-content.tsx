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

export type ChatGroupModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  rightPanelMode: 'auto' | 'settings';
  rightPanelFolded: boolean;
  onToggleRightPanelFold: () => void;
  onToggleRightPanelSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatGroupModeContent({
  allTargets,
  rightPanelMode: _rightPanelMode,
  rightPanelFolded,
  onToggleRightPanelFold: _onToggleRightPanelFold,
  onToggleRightPanelSettings: _onToggleRightPanelSettings,
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
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.group ?? null);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);

  const host = useGroupConversationModeHost({
    authStatus,
    currentUserId,
  });
  const hostOnCreateThread = host.onCreateThread;
  const hostOnSelectTarget = host.onSelectTarget;

  // Bridge sidebar target selection to host
  const prevTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousTargetId = prevTargetIdRef.current;

    if (
      storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID
      && previousTargetId !== GROUP_CREATE_INTENT_TARGET_ID
    ) {
      setSelectedTargetForSource('group', null);
      void hostOnCreateThread?.();
    } else if (
      storeSelectedTargetId
      && storeSelectedTargetId !== previousTargetId
    ) {
      hostOnSelectTarget?.(storeSelectedTargetId);
    }

    prevTargetIdRef.current = storeSelectedTargetId;
  }, [hostOnCreateThread, hostOnSelectTarget, setSelectedTargetForSource, storeSelectedTargetId]);

  // Sync setupState to store
  useEffect(() => {
    setChatSetupState('group', host.adapter.setupState);
  }, [host.adapter.setupState, setChatSetupState]);

  const selectedTargetId = storeSelectedTargetId || host.selectedTargetId || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );
  const hostSelectedTargetExists = useMemo(
    () => host.selectedTargetId
      ? allTargets.some((target) => target.id === host.selectedTargetId)
      : false,
    [allTargets, host.selectedTargetId],
  );

  // Sync host selectedTargetId to store only after the sidebar target exists.
  useEffect(() => {
    if (!host.selectedTargetId || storeSelectedTargetId || !hostSelectedTargetExists) return;
    setSelectedTargetForSource('group', host.selectedTargetId);
  }, [host.selectedTargetId, hostSelectedTargetExists, setSelectedTargetForSource, storeSelectedTargetId]);

  const currentViewModeKey = selectedTarget
    ? `${selectedTarget.source}:${selectedTarget.id}`
    : 'group:landing';
  const currentViewMode = useAppStore((state) => state.viewModeBySourceTarget[currentViewModeKey] || 'chat');

  const canonicalMessages = host.messages || [];
  const transcriptProps = useGroupCanonicalTranscriptProps();
  const stagePanelProps = useGroupCanonicalStagePanelProps();

  const rightPanelNode = useMemo(() => {
    if (!selectedTarget || rightPanelFolded) return null;
    if (host.rightPanelContent) return host.rightPanelContent;
    return null;
  }, [host.rightPanelContent, selectedTarget, rightPanelFolded]);

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!selectedTarget) return;
    setChatViewMode('group', selectedTarget.id, mode);
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
      transcriptProps={transcriptProps}
      stagePanelProps={stagePanelProps}
      topContent={host.topContent}
      composer={host.composerContent}
      auxiliaryOverlayContent={host.auxiliaryOverlayContent}
    />
  );
}
