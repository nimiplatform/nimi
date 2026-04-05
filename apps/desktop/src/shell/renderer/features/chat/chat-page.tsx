import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CanonicalConversationShell,
  CanonicalStagePanel,
  CanonicalTranscriptView,
  createConversationShellViewModel,
  ConversationSetupPanel,
  type ConversationSetupAction,
} from '@nimiplatform/nimi-kit/features/chat';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '@renderer/features/runtime-config/runtime-config-navigation-events';
import { useRuntimeConfigPanelController } from '@renderer/features/runtime-config/runtime-config-panel-controller';
import { createDesktopConversationModeRegistry, resolveDesktopConversationModeHost } from './chat-mode-registry';
import { useHumanConversationModeHost } from './chat-human-adapter';
import { useAiConversationModeHost } from './chat-ai-shell-adapter';
import { useAgentConversationModeHost } from './chat-agent-shell-adapter';

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authStatus = useAppStore((state) => state.auth.status);
  const chatMode = useAppStore((state) => state.chatMode);
  const chatSourceFilter = useAppStore((state) => state.chatSourceFilter);
  const selectedTargetBySource = useAppStore((state) => state.selectedTargetBySource);
  const viewModeBySourceTarget = useAppStore((state) => state.viewModeBySourceTarget);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setChatSourceFilter = useAppStore((state) => state.setChatSourceFilter);
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
  const localizedModes = useMemo(
    () => registry.hosts.map((host) => ({
      ...host.availability,
      label: t(`Chat.mode.${host.mode}`, { defaultValue: host.availability.label }),
    })),
    [registry.hosts, t],
  );

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

  const viewModel = useMemo(() => {
    if (!activeHost) {
      return null;
    }
    return createConversationShellViewModel({
      adapter: activeHost.adapter,
      activeMode: activeHost.mode,
      activeThreadId: activeHost.activeThreadId,
      modes: localizedModes,
    });
  }, [activeHost, localizedModes]);

  const allTargets = useMemo(
    () => registry.hosts.flatMap((host) => host.targets || []),
    [registry.hosts],
  );
  const visibleTargets = useMemo(
    () => chatSourceFilter === 'all'
      ? allTargets
      : allTargets.filter((target) => target.source === chatSourceFilter),
    [allTargets, chatSourceFilter],
  );
  const selectedTargetId = selectedTargetBySource[chatMode] || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );

  useEffect(() => {
    if (!selectedTargetId || selectedTarget) {
      return;
    }
    setSelectedTargetForSource(chatMode, null);
  }, [chatMode, selectedTarget, selectedTargetId, setSelectedTargetForSource]);

  useEffect(() => {
    setSettingsOpen(false);
    setProfileOpen(false);
    setRightSidebarOpen(false);
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
    setChatMode(action.returnToMode || chatMode);
    setActiveTab('runtime');
    dispatchRuntimeConfigOpenPage(toRuntimePageId(action.targetId));
  };

  const handleSelectTarget = useCallback((targetId: string | null) => {
    const nextSource = targetId
      ? registry.hosts.find((host) => (host.targets || []).some((target) => target.id === targetId))?.mode || null
      : chatMode;
    if (!targetId) {
      setSelectedTargetForSource(chatMode, null);
      return;
    }
    const ownerHost = nextSource
      ? resolveDesktopConversationModeHost(registry, nextSource)
      : null;
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
  }, [chatMode, registry, setChatMode, setSelectedTargetForSource]);

  const chatSurface = useCallback(() => {
    if (!activeHost || !viewModel) {
      return null;
    }
    if (viewModel.setupState.status !== 'ready') {
      return (
        <div className="flex min-h-[320px] items-center justify-center px-6">
          <ConversationSetupPanel
            state={viewModel.setupState}
            description={activeHost.renderSetupDescription?.(viewModel.setupState, viewModel)}
            onAction={activeHost.onSetupAction || handleSetupAction}
          />
        </div>
      );
    }
    if (!selectedTarget) {
      return activeHost.renderEmptyState?.(viewModel) || null;
    }
    return (
      <CanonicalTranscriptView
        messages={canonicalMessages}
        pendingFirstBeat={activeHost.stagePanelProps?.pendingFirstBeat}
        {...activeHost.transcriptProps}
      />
    );
  }, [activeHost, canonicalMessages, handleSetupAction, selectedTarget, viewModel]);

  const stageSurface = useCallback(() => {
    if (!activeHost || !viewModel) {
      return null;
    }
    if (viewModel.setupState.status !== 'ready') {
      return null;
    }
    if (!selectedTarget) {
      return activeHost.renderEmptyState?.(viewModel) || null;
    }
    return (
      <CanonicalStagePanel
        characterData={activeHost.characterData}
        messages={canonicalMessages}
        pendingFirstBeat={activeHost.stagePanelProps?.pendingFirstBeat}
        {...activeHost.stagePanelProps}
      />
    );
  }, [activeHost, canonicalMessages, selectedTarget, viewModel]);

  if (!activeHost || !viewModel) {
    return <div className="flex min-h-0 flex-1" />;
  }

  return (
    <div className="flex min-h-0 flex-1 p-3">
      <CanonicalConversationShell
        className="min-h-0 flex-1"
        sourceFilter={chatSourceFilter}
        availableSources={registry.visibleModes}
        targets={visibleTargets}
        selectedTargetId={selectedTargetId}
        selectedTarget={selectedTarget}
        onSelectTarget={handleSelectTarget}
        onSourceFilterChange={(filter) => {
          setChatSourceFilter(filter);
          if (filter !== 'all') {
            setChatMode(filter);
          }
        }}
        viewMode={currentViewMode}
        onViewModeChange={(mode) => {
          if (!selectedTarget) {
            return;
          }
          setChatViewMode(chatMode, selectedTarget.id, mode);
        }}
        characterData={activeHost.characterData}
        messages={canonicalMessages}
        renderChatTranscript={chatSurface}
        renderStagePanel={stageSurface}
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
