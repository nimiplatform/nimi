import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanonicalConversationShell,
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useAgentConversationModeHost } from './chat-agent-shell-adapter';
import { ChatRightPanelCharacterRail } from './chat-right-panel-character-rail';
import { ChatRightPanelSettings } from './chat-right-panel-settings';

export type ChatAgentModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  rightPanelMode: 'auto' | 'settings';
  rightPanelFolded: boolean;
  onToggleRightPanelFold: () => void;
  onToggleRightPanelSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatAgentModeContent({
  allTargets,
  rightPanelMode,
  rightPanelFolded,
  onToggleRightPanelFold,
  onToggleRightPanelSettings,
  onSetupAction,
  onSelectTarget,
}: ChatAgentModeContentProps) {
  const [diagnosticsSectionVisible, setDiagnosticsSectionVisible] = useState(false);
  const authStatus = useAppStore((state) => state.auth.status);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const agentConversationSelection = useAppStore((state) => state.agentConversationSelection);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const lastSelectedAgentThread = useAppStore((state) => state.lastSelectedThreadByMode.agent ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.agent ?? null);

  const host = useAgentConversationModeHost({
    authStatus,
    diagnosticsVisible: rightPanelMode === 'settings' && !rightPanelFolded && diagnosticsSectionVisible,
    onDiagnosticsVisibilityChange: setDiagnosticsSectionVisible,
    runtimeConfigState: null,
    runtimeFields,
    selection: agentConversationSelection,
    lastSelectedThreadId: lastSelectedAgentThread,
    setSelection: setAgentConversationSelection,
  });

  // Bridge sidebar target selection to host
  const prevTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (storeSelectedTargetId && storeSelectedTargetId !== prevTargetIdRef.current) {
      host.onSelectTarget?.(storeSelectedTargetId);
    }
    prevTargetIdRef.current = storeSelectedTargetId;
  }, [host, storeSelectedTargetId]);

  // Sync setupState to store
  useEffect(() => {
    setChatSetupState('agent', host.adapter.setupState);
  }, [host.adapter.setupState, setChatSetupState]);

  // Sync host selectedTargetId to store
  useEffect(() => {
    if (!host.selectedTargetId || storeSelectedTargetId) {
      return;
    }
    setSelectedTargetForSource('agent', host.selectedTargetId);
  }, [host.selectedTargetId, setSelectedTargetForSource, storeSelectedTargetId]);
  useEffect(() => {
    if (rightPanelMode === 'settings' && !rightPanelFolded) {
      return;
    }
    setDiagnosticsSectionVisible(false);
  }, [rightPanelFolded, rightPanelMode]);

  const selectedTargetId = storeSelectedTargetId || host.selectedTargetId || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );

  const currentViewModeKey = selectedTarget
    ? `${selectedTarget.source}:${selectedTarget.id}`
    : 'agent:landing';
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
    if (host.rightPanelContent) {
      return host.rightPanelContent;
    }
    return (
      <ChatRightPanelCharacterRail
        selectedTarget={selectedTarget}
        characterData={host.characterData}
        onToggleSettings={onToggleRightPanelSettings}
        settingsActive={false}
        thinkingState={host.thinkingState}
        onThinkingToggle={host.onThinkingToggle}
        onToggleFold={onToggleRightPanelFold}
        handsFreeState={host.handsFreeState}
      />
    );
  }, [host, selectedTarget, rightPanelMode, rightPanelFolded, onToggleRightPanelSettings, onToggleRightPanelFold]);

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!selectedTarget) {
      return;
    }
    setChatViewMode('agent', selectedTarget.id, mode);
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
