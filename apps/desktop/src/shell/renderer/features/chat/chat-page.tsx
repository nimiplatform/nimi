import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CanonicalConversationShell,
  type ConversationSetupAction,
} from '@nimiplatform/nimi-kit/features/chat';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '@renderer/features/runtime-config/runtime-config-navigation-events';
import { useRuntimeConfigPanelController } from '@renderer/features/runtime-config/runtime-config-panel-controller';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { createDesktopConversationModeRegistry, resolveDesktopConversationModeHost } from './chat-mode-registry';
import { useHumanConversationModeHost } from './chat-human-adapter';
import { useAiConversationModeHost } from './chat-ai-shell-adapter';
import { useAgentConversationModeHost } from './chat-agent-shell-adapter';
import { ChatContactsSidebar } from './chat-contacts-sidebar';
import { ChatAiSessionListPanel } from './chat-ai-session-list-panel';
import { ChatRightPanelCharacterRail } from './chat-right-panel-character-rail';
import { ChatRightPanelSettings } from './chat-right-panel-settings';

function toRuntimePageId(targetId: Extract<ConversationSetupAction, { kind: 'open-settings' }>['targetId']) {
  if (targetId === 'runtime-local') {
    return 'local' as const;
  }
  if (targetId === 'runtime-cloud') {
    return 'cloud' as const;
  }
  return 'overview' as const;
}

export function ChatPage() {
  const navigate = useNavigate();
  const authStatus = useAppStore((state) => state.auth.status);
  const chatMode = useAppStore((state) => state.chatMode);
  const selectedTargetBySource = useAppStore((state) => state.selectedTargetBySource);
  const viewModeBySourceTarget = useAppStore((state) => state.viewModeBySourceTarget);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setChatProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const lastSelectedThreadByMode = useAppStore((state) => state.lastSelectedThreadByMode);
  const aiConversationSelection = useAppStore((state) => state.aiConversationSelection);
  const setAiConversationSelection = useAppStore((state) => state.setAiConversationSelection);
  const agentConversationSelection = useAppStore((state) => state.agentConversationSelection);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const chatSetupState = useAppStore((state) => state.chatSetupState);
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const [rightPanelMode, setRightPanelMode] = useState<'auto' | 'settings'>('auto');

  const runtimeConfigController = useRuntimeConfigPanelController();
  const humanHost = useHumanConversationModeHost({
    authStatus,
    selectedChatId,
    setSelectedChatId,
    setChatProfilePanelTarget,
  });
  const { host: aiHost } = useAiConversationModeHost({
    runtimeConfigState: runtimeConfigController.state,
    runtimeFields,
    selection: aiConversationSelection,
    lastSelectedThreadId: lastSelectedThreadByMode.ai || null,
    setSelection: setAiConversationSelection,
  });
  const agentHost = useAgentConversationModeHost({
    authStatus,
    runtimeConfigState: runtimeConfigController.state,
    runtimeFields,
    selection: agentConversationSelection,
    lastSelectedThreadId: lastSelectedThreadByMode.agent || null,
    setSelection: setAgentConversationSelection,
  });

  const registry = useMemo(() => createDesktopConversationModeRegistry({
    authStatus,
    aiHost,
    humanHost,
    agentHost,
  }), [agentHost, aiHost, authStatus, humanHost]);
  const activeHost = useMemo(
    () => resolveDesktopConversationModeHost(registry, chatMode),
    [chatMode, registry],
  );

  useEffect(() => {
    if (!activeHost) {
      return;
    }
    if (chatMode !== activeHost.mode) {
      setChatMode(activeHost.mode);
    }
  }, [activeHost, chatMode, setChatMode]);

  useEffect(() => {
    if (chatMode !== 'human') {
      return;
    }
    if (selectedChatId || !lastSelectedThreadByMode.human) {
      return;
    }
    setSelectedChatId(lastSelectedThreadByMode.human);
  }, [chatMode, lastSelectedThreadByMode.human, selectedChatId, setSelectedChatId]);

  useEffect(() => {
    if (!activeHost) {
      return;
    }
    if (chatSetupState[activeHost.mode] === activeHost.adapter.setupState) {
      return;
    }
    setChatSetupState(activeHost.mode, activeHost.adapter.setupState);
  }, [activeHost, chatSetupState, setChatSetupState]);

  // Collect all targets from all hosts for the sidebar
  const allTargets = useMemo(
    () => registry.hosts.flatMap((host) => host.targets || []),
    [registry.hosts],
  );

  const storeSelectedTargetId = selectedTargetBySource[chatMode] || null;
  const selectedTargetId = storeSelectedTargetId || activeHost?.selectedTargetId || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );

  useEffect(() => {
    if (!activeHost?.selectedTargetId || storeSelectedTargetId) {
      return;
    }
    setSelectedTargetForSource(activeHost.mode, activeHost.selectedTargetId);
  }, [activeHost, setSelectedTargetForSource, storeSelectedTargetId]);

  // If selected target disappeared (e.g. logout), clear it
  useEffect(() => {
    if (!selectedTargetId || selectedTarget) {
      return;
    }
    // Target not found — if not logged in, fall back to AI
    if (authStatus !== 'authenticated') {
      setChatMode('ai');
      setSelectedTargetForSource('ai', 'ai:assistant');
    } else {
      setSelectedTargetForSource(chatMode, null);
    }
  }, [authStatus, chatMode, selectedTarget, selectedTargetId, setChatMode, setSelectedTargetForSource]);

  // Close transient panels on target/mode change
  useEffect(() => {
    setRightPanelMode('auto');
  }, [chatMode, selectedTargetId]);

  const currentViewModeKey = selectedTarget
    ? `${selectedTarget.source}:${selectedTarget.id}`
    : `${chatMode}:landing`;
  const currentViewMode = viewModeBySourceTarget[currentViewModeKey] || 'stage';

  const canonicalMessages = activeHost?.messages || [];

  const handleSetupAction = (action: ConversationSetupAction) => {
    if (action.kind === 'sign-in') {
      setChatMode(action.returnToMode || chatMode);
      setActiveTab('chat');
      void navigate('/login', {
        state: { returnToChat: true },
      });
      return;
    }
    // AI/Agent mode: open the settings drawer (which contains the route picker)
    // instead of navigating away to the runtime config page.
    if (chatMode === 'ai' || chatMode === 'agent' || action.returnToMode === 'ai' || action.returnToMode === 'agent') {
      setChatMode(action.returnToMode || chatMode);
      setRightPanelMode('settings');
      return;
    }
    setChatMode(action.returnToMode || chatMode);
    setActiveTab('runtime');
    dispatchRuntimeConfigOpenPage(toRuntimePageId(action.targetId));
  };

  // Simplified target selection — sidebar drives this
  const handleSelectTarget = useCallback((targetId: string) => {
    const ownerHost = registry.hosts.find(
      (host) => (host.targets || []).some((target) => target.id === targetId),
    );
    if (!ownerHost) {
      return;
    }
    if (chatMode !== ownerHost.mode) {
      setChatMode(ownerHost.mode);
    }
    setSelectedTargetForSource(ownerHost.mode, targetId);
    ownerHost.onSelectTarget?.(targetId);
    if (!ownerHost.onSelectTarget && ownerHost.onSelectThread) {
      ownerHost.onSelectThread(targetId);
    }
  }, [chatMode, registry.hosts, setChatMode, setSelectedTargetForSource]);

  // Shell's onSelectTarget allows clearing (back button)
  const handleShellSelectTarget = useCallback((targetId: string | null) => {
    if (!targetId) {
      // Back button pressed — don't clear, just ignore (sidebar controls navigation)
      return;
    }
    handleSelectTarget(targetId);
  }, [handleSelectTarget]);

  const toggleRightPanelSettings = useCallback(() => {
    setRightPanelMode((prev) => (prev === 'settings' ? 'auto' : 'settings'));
  }, []);

  // Compute right panel content based on mode
  const rightPanelNode = useMemo(() => {
    if (!activeHost || !selectedTarget) {
      return null;
    }
    const settingsActive = rightPanelMode === 'settings';
    if (settingsActive) {
      return (
        <ChatRightPanelSettings onToggleSettings={toggleRightPanelSettings}>
          {activeHost.settingsContent ?? null}
        </ChatRightPanelSettings>
      );
    }
    // Auto mode: AI shows session list, Human/Agent shows character rail
    if (activeHost.mode === 'ai') {
      const threadSummaries = activeHost.adapter.threadAdapter.listThreads();
      const threads = Array.isArray(threadSummaries) ? threadSummaries : [];
      return (
        <ChatAiSessionListPanel
          threads={threads}
          activeThreadId={activeHost.activeThreadId}
          onSelectThread={(threadId) => activeHost.onSelectThread?.(threadId)}
          onCreateThread={activeHost.onCreateThread ? () => void activeHost.onCreateThread!() : undefined}
          onArchiveThread={activeHost.onArchiveThread ? (id) => void activeHost.onArchiveThread!(id) : undefined}
          onRenameThread={activeHost.onRenameThread}
          routeLabel={selectedTarget?.metadata?.routeLabel as string | null ?? null}
          onToggleSettings={toggleRightPanelSettings}
          settingsActive={false}
        />
      );
    }
    // Human/Agent: use host-provided rightPanelContent, or fall back to CharacterRail
    if (activeHost.rightPanelContent) {
      return activeHost.rightPanelContent;
    }
    return (
      <ChatRightPanelCharacterRail
        selectedTarget={selectedTarget}
        characterData={activeHost.characterData}
        onToggleSettings={toggleRightPanelSettings}
        settingsActive={false}
      />
    );
  }, [activeHost, selectedTarget, rightPanelMode, toggleRightPanelSettings]);

  if (!activeHost) {
    return <div className="flex min-h-0 flex-1" />;
  }

  return (
    <div data-testid={E2E_IDS.chatPage} className="flex min-h-0 flex-1">
      <CanonicalConversationShell
        className="min-h-0 flex-1"
        hideTargetPane
        hideCharacterRail
        rightPanel={rightPanelNode}
        sourceFilter="all"
        targets={allTargets}
        selectedTargetId={selectedTargetId}
        selectedTarget={selectedTarget}
        onSelectTarget={handleShellSelectTarget}
        viewMode={currentViewMode}
        onViewModeChange={(mode) => {
          if (!selectedTarget) {
            return;
          }
          setChatViewMode(chatMode, selectedTarget.id, mode);
        }}
        setupState={activeHost.adapter.setupState}
        setupDescription={activeHost.setupDescription}
        onSetupAction={handleSetupAction}
        characterData={activeHost.characterData}
        messages={canonicalMessages}
        transcriptProps={activeHost.transcriptProps}
        stagePanelProps={activeHost.stagePanelProps}
        composer={activeHost.composerContent}
        auxiliaryOverlayContent={activeHost.auxiliaryOverlayContent}
      />
      {authStatus === 'authenticated' ? (
        <ChatContactsSidebar
          targets={allTargets}
          selectedTargetId={selectedTargetId}
          onSelectTarget={handleSelectTarget}
        />
      ) : null}
    </div>
  );
}
