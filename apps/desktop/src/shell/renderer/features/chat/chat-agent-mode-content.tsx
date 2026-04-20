import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CanonicalConversationShell,
  type CanonicalConversationAnchoredSurfacePlacement,
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAgentConversationModeHost } from './chat-agent-shell-adapter';
import { ChatAgentSceneBackground } from './chat-agent-scene-background';
import { ChatSideSheet } from './chat-side-sheet';

const ChatAgentAvatarOverlay = lazy(async () => {
  const mod = await import('./chat-agent-avatar-overlay');
  return { default: mod.ChatAgentAvatarOverlay };
});

type ChatAvatarOverlayErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ChatAvatarOverlayErrorBoundaryState = {
  failed: boolean;
};

class ChatAvatarOverlayErrorBoundary extends Component<
  ChatAvatarOverlayErrorBoundaryProps,
  ChatAvatarOverlayErrorBoundaryState
> {
  constructor(props: ChatAvatarOverlayErrorBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): ChatAvatarOverlayErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    logRendererEvent({
      level: 'error',
      area: 'chat',
      message: 'action:chat-agent-avatar-overlay:failed',
      details: {
        error: error.message,
      },
    });
  }

  override render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

export type ChatAgentModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatAgentModeContent({
  allTargets,
  settingsOpen,
  onCloseSettings,
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
    diagnosticsVisible: settingsOpen && diagnosticsSectionVisible,
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
    if (settingsOpen) {
      return;
    }
    setDiagnosticsSectionVisible(false);
  }, [settingsOpen]);

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
  const avatarStagePlacement: CanonicalConversationAnchoredSurfacePlacement = host.avatarStagePlacement || 'right-center';
  const sceneBackground = selectedTarget ? (
    <ChatAgentSceneBackground
      characterData={host.characterData}
    />
  ) : null;

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!selectedTarget) {
      return;
    }
    setChatViewMode('agent', selectedTarget.id, mode);
  }, [selectedTarget, setChatViewMode]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
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
        sceneBackground={sceneBackground}
        composer={host.composerContent}
        auxiliaryOverlayContent={host.auxiliaryOverlayContent}
      />
      {selectedTarget ? (
        <ChatAvatarOverlayErrorBoundary>
          <Suspense fallback={null}>
            <ChatAgentAvatarOverlay
              selectedTarget={selectedTarget}
              characterData={host.characterData}
              placement={avatarStagePlacement}
              settingsActive={settingsOpen}
              thinkingState={host.thinkingState}
              onThinkingToggle={host.onThinkingToggle}
              handsFreeState={host.handsFreeState}
            />
          </Suspense>
        </ChatAvatarOverlayErrorBoundary>
      ) : null}
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
