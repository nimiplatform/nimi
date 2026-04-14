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
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';

const ICON_PANEL = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M15 3v18" />
  </svg>
);

const ICON_SETTINGS = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ICON_THINKING = (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
    <path d="M5.5 13.5V12a3.5 3.5 0 0 1-1.73-6.55A4 4 0 0 1 11.5 4a3.5 3.5 0 0 1 .77 6.91V13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.5 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="8" cy="5.5" r="0.75" fill="currentColor" />
  </svg>
);

function FloatingIconButton(props: {
  icon: React.ReactNode;
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={props.tooltip} placement="top">
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.disabled ? undefined : props.onClick}
        className={[
          'inline-flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150',
          'shadow-[0_2px_8px_rgba(15,23,42,0.08)]',
          props.active
            ? 'border border-emerald-400 bg-emerald-500 text-white'
            : 'border border-slate-200/80 bg-white/95 text-slate-500',
          props.disabled
            ? 'cursor-not-allowed opacity-50'
            : props.active
              ? 'hover:bg-emerald-600 hover:border-emerald-500 hover:text-white'
              : 'hover:border-emerald-300 hover:text-teal-600',
        ].join(' ')}
      >
        {props.icon}
      </button>
    </Tooltip>
  );
}

function FoldedPanelFloatingBar(props: {
  onUnfold: () => void;
  onToggleSettings: () => void;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-[58px] bottom-3 z-10 flex flex-col gap-1.5">
      {props.thinkingState ? (
        <FloatingIconButton
          icon={ICON_THINKING}
          tooltip={props.thinkingState === 'on'
            ? t('Chat.thinkingTooltipOn', { defaultValue: 'Thinking enabled — click to disable' })
            : props.thinkingState === 'unsupported'
              ? t('Chat.thinkingTooltipUnsupported', { defaultValue: 'Thinking is not supported by the current route' })
              : t('Chat.thinkingTooltipOff', { defaultValue: 'Thinking disabled — click to enable' })}
          active={props.thinkingState === 'on'}
          disabled={props.thinkingState === 'unsupported'}
          onClick={props.onThinkingToggle}
        />
      ) : null}
      <FloatingIconButton
        icon={ICON_SETTINGS}
        tooltip={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })}
        onClick={props.onToggleSettings}
      />
      <FloatingIconButton
        icon={ICON_PANEL}
        tooltip={t('Chat.togglePanel', { defaultValue: 'Toggle panel' })}
        onClick={props.onUnfold}
      />
    </div>
  );
}

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
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource[state.chatMode] ?? null);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setChatProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const lastSelectedAiThread = useAppStore((state) => state.lastSelectedThreadByMode.ai ?? null);
  const lastSelectedAgentThread = useAppStore((state) => state.lastSelectedThreadByMode.agent ?? null);
  const lastSelectedHumanThread = useAppStore((state) => state.lastSelectedThreadByMode.human ?? null);
  const aiConversationSelection = useAppStore((state) => state.aiConversationSelection);
  const setAiConversationSelection = useAppStore((state) => state.setAiConversationSelection);
  const agentConversationSelection = useAppStore((state) => state.agentConversationSelection);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const currentSetupState = useAppStore((state) => state.chatSetupState[state.chatMode] ?? null);
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const [rightPanelMode, setRightPanelMode] = useState<'auto' | 'settings'>('auto');
  const [rightPanelFolded, setRightPanelFolded] = useState(false);
  const toggleRightPanelFold = useCallback(() => {
    setRightPanelFolded((prev) => !prev);
  }, []);

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
    lastSelectedThreadId: lastSelectedAiThread,
    setSelection: setAiConversationSelection,
  });
  const agentHost = useAgentConversationModeHost({
    authStatus,
    runtimeConfigState: runtimeConfigController.state,
    runtimeFields,
    selection: agentConversationSelection,
    lastSelectedThreadId: lastSelectedAgentThread,
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
    if (selectedChatId || !lastSelectedHumanThread) {
      return;
    }
    setSelectedChatId(lastSelectedHumanThread);
  }, [chatMode, lastSelectedHumanThread, selectedChatId, setSelectedChatId]);

  useEffect(() => {
    if (!activeHost) {
      return;
    }
    if (currentSetupState === activeHost.adapter.setupState) {
      return;
    }
    setChatSetupState(activeHost.mode, activeHost.adapter.setupState);
  }, [activeHost, currentSetupState, setChatSetupState]);

  // Collect all targets from all hosts for the sidebar
  const allTargets = useMemo(
    () => registry.hosts.flatMap((host) => host.targets || []),
    [registry.hosts],
  );

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
  const currentViewMode = useAppStore((state) => state.viewModeBySourceTarget[currentViewModeKey] || 'chat');

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
    if (rightPanelFolded) {
      return null;
    }
    const settingsActive = rightPanelMode === 'settings';
    if (settingsActive) {
      return (
        <ChatRightPanelSettings onToggleSettings={toggleRightPanelSettings} thinkingState={activeHost.thinkingState} onThinkingToggle={activeHost.onThinkingToggle}>
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
          onToggleSettings={toggleRightPanelSettings}
          settingsActive={false}
          thinkingState={activeHost.thinkingState}
          onThinkingToggle={activeHost.onThinkingToggle}
          onToggleFold={toggleRightPanelFold}
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
        thinkingState={activeHost.thinkingState}
        onThinkingToggle={activeHost.onThinkingToggle}
        onToggleFold={toggleRightPanelFold}
        handsFreeState={activeHost.handsFreeState}
      />
    );
  }, [activeHost, selectedTarget, rightPanelMode, rightPanelFolded, toggleRightPanelSettings, toggleRightPanelFold]);

  if (!activeHost) {
    return <div className="flex min-h-0 flex-1" />;
  }

  return (
    <div data-testid={E2E_IDS.chatPage} className="relative flex min-h-0 flex-1">
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
        topContent={activeHost.topContent}
        composer={activeHost.composerContent}
        auxiliaryOverlayContent={activeHost.auxiliaryOverlayContent}
      />
      {rightPanelFolded && activeHost ? (
        <FoldedPanelFloatingBar
          onUnfold={toggleRightPanelFold}
          onToggleSettings={() => {
            setRightPanelFolded(false);
            setRightPanelMode('settings');
          }}
          thinkingState={activeHost.thinkingState}
          onThinkingToggle={activeHost.onThinkingToggle}
        />
      ) : null}
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
