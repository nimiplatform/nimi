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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  const runtimeConfigController = useRuntimeConfigPanelController();
  const aiRouteReadinessPending = runtimeConfigController.hydrated
    ? runtimeConfigController.discovering
      || (!runtimeConfigController.runtimeDaemonUpdatedAt && !runtimeConfigController.runtimeDaemonError)
    : true;
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

  const selectedTargetId = selectedTargetBySource[chatMode] || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );

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
    setSettingsOpen(false);
    setProfileOpen(false);
    setRightSidebarOpen(false);
  }, [chatMode, selectedTargetId]);

  useEffect(() => {
    if (!activeHost?.rightSidebarContent || !activeHost.rightSidebarAutoOpenKey) {
      return;
    }
    setRightSidebarOpen(true);
  }, [activeHost?.rightSidebarAutoOpenKey, activeHost?.rightSidebarContent]);

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

  if (!activeHost) {
    return <div className="flex min-h-0 flex-1" />;
  }

  if (activeHost.mode === 'ai' && aiRouteReadinessPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-400">
        Loading AI routes...
      </div>
    );
  }

  return (
    <div data-testid={E2E_IDS.chatPage} className="flex min-h-0 flex-1">
      {authStatus === 'authenticated' ? (
        <ChatContactsSidebar
          targets={allTargets}
          selectedTargetId={selectedTargetId}
          onSelectTarget={handleSelectTarget}
        />
      ) : null}
      <CanonicalConversationShell
        className="min-h-0 flex-1"
        hideTargetPane
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
        settingsDrawer={activeHost.settingsContent}
        settingsDrawerTitle={activeHost.settingsDrawerTitle}
        settingsDrawerSubtitle={activeHost.settingsDrawerSubtitle}
        profileDrawer={activeHost.profileContent}
        profileDrawerTitle={activeHost.profileDrawerTitle}
        profileDrawerSubtitle={activeHost.profileDrawerSubtitle}
        rightSidebar={activeHost.rightSidebarContent}
        rightSidebarOverlayMenu={activeHost.rightSidebarOverlayMenu}
        rightSidebarResetKey={activeHost.rightSidebarResetKey}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        profileOpen={profileOpen}
        onProfileOpenChange={setProfileOpen}
        rightSidebarOpen={rightSidebarOpen}
        onRightSidebarOpenChange={setRightSidebarOpen}
        auxiliaryOverlayContent={activeHost.auxiliaryOverlayContent}
      />
    </div>
  );
}
