import { Component, Suspense, lazy, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import type { ConversationSetupAction } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '@renderer/features/runtime-config/runtime-config-navigation-events';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ChatContactsSidebar } from './chat-contacts-sidebar';
import { useChatTargetsForSidebar } from './chat-sidebar-targets';
import { useChatGroupCreateController } from './chat-group-create-controller';

function createLazyImportError(label: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error || 'unknown import error');
  const wrapped = new Error(`${label}: ${reason}`);
  wrapped.name = 'LazyImportError';
  wrapped.cause = error;
  return wrapped;
}

const ChatHumanModeContent = lazy(async () => {
  try {
    const mod = await import('./chat-human-mode-content');
    return { default: mod.ChatHumanModeContent };
  } catch (error) {
    throw createLazyImportError('chat:human-mode-content', error);
  }
});

const ChatNimiModeContent = lazy(async () => {
  try {
    const mod = await import('./chat-nimi-mode-content');
    return { default: mod.ChatNimiModeContent };
  } catch (error) {
    throw createLazyImportError('chat:nimi-mode-content', error);
  }
});

const ChatGroupModeContent = lazy(async () => {
  try {
    const mod = await import('./chat-group-mode-content');
    return { default: mod.ChatGroupModeContent };
  } catch (error) {
    throw createLazyImportError('chat:group-mode-content', error);
  }
});

const ChatAgentModeContent = lazy(async () => {
  try {
    const mod = await import('./chat-agent-mode-content');
    return { default: mod.ChatAgentModeContent };
  } catch (error) {
    throw createLazyImportError('chat:agent-mode-content', error);
  }
});

type ChatModeSurfaceErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  mode: string;
  resetKey: string;
};

type ChatModeSurfaceErrorBoundaryState = {
  failed: boolean;
};

class ChatModeSurfaceErrorBoundary extends Component<
  ChatModeSurfaceErrorBoundaryProps,
  ChatModeSurfaceErrorBoundaryState
> {
  constructor(props: ChatModeSurfaceErrorBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): ChatModeSurfaceErrorBoundaryState {
    return { failed: true };
  }

  override componentDidUpdate(prevProps: ChatModeSurfaceErrorBoundaryProps): void {
    if (
      (prevProps.mode !== this.props.mode || prevProps.resetKey !== this.props.resetKey)
      && this.state.failed
    ) {
      this.setState({ failed: false });
    }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logRendererEvent({
      level: 'error',
      area: 'chat',
      message: 'action:chat-mode-surface:failed',
      details: {
        chatMode: this.props.mode,
        error: error.message,
        cause: error.cause instanceof Error ? error.cause.message : undefined,
        componentStack: errorInfo.componentStack,
      },
    });
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ChatModeUnavailable({ mode }: { mode: string }) {
  const copyByMode: Record<string, string> = {
    Agent: 'Agent mode is temporarily unavailable. Switch to another conversation mode or reopen the app.',
    Group: 'Group mode is temporarily unavailable. Switch to another conversation mode or reopen the app.',
    Human: 'Human mode is temporarily unavailable. Switch to another conversation mode or reopen the app.',
    Nimi: 'Nimi mode is temporarily unavailable. Switch to another conversation mode or reopen the app.',
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--nimi-text-secondary)]">
      {copyByMode[mode] ?? `${mode} mode is temporarily unavailable. Switch to another conversation mode or reopen the app.`}
    </div>
  );
}

function toRuntimePageId(targetId: Extract<ConversationSetupAction, { kind: 'open-settings' }>['targetId']) {
  if (targetId === 'runtime-local') {
    return 'models' as const;
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
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [nimiThreadListOpen, setNimiThreadListOpen] = useState(false);
  const groupCreateController = useChatGroupCreateController();

  const allTargets = useChatTargetsForSidebar(authStatus);

  const closeTransientSheets = useCallback(() => {
    setChatSettingsOpen(false);
    setNimiThreadListOpen(false);
  }, []);

  const toggleChatSettings = useCallback(() => {
    setChatSettingsOpen((current) => {
      const next = !current;
      if (next) {
        setNimiThreadListOpen(false);
      }
      return next;
    });
  }, []);

  const toggleNimiThreadList = useCallback(() => {
    setNimiThreadListOpen((current) => {
      const next = !current;
      if (next) {
        setChatSettingsOpen(false);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!storeSelectedTargetId) {
      return;
    }
    const targetExists = allTargets.some((target) => target.id === storeSelectedTargetId);
    if (targetExists) {
      return;
    }
    if (authStatus !== 'authenticated') {
      setChatMode('ai');
      setSelectedTargetForSource('ai', 'ai:assistant');
      return;
    }
    // Agent mode owns its selection via `agentConversationSelection` and synthesizes
    // a target when the agent isn't in the friends sidebar (e.g. world-launched agents).
    // Clearing here would fight the agent shell's restore effect and loop.
    if (chatMode === 'agent') {
      return;
    }
    setSelectedTargetForSource(chatMode, null);
  }, [allTargets, authStatus, chatMode, setChatMode, setSelectedTargetForSource, storeSelectedTargetId]);

  useEffect(() => {
    setChatSettingsOpen(false);
  }, [chatMode, storeSelectedTargetId]);

  useEffect(() => {
    if (chatMode === 'ai') {
      return;
    }
    setNimiThreadListOpen(false);
  }, [chatMode]);

  const handleSetupAction = useCallback((action: ConversationSetupAction) => {
    if (action.kind === 'sign-in') {
      setChatMode(action.returnToMode || chatMode);
      setActiveTab('chat');
      void navigate('/login', {
        state: { returnToChat: true },
      });
      return;
    }
    if (chatMode === 'ai' || chatMode === 'agent' || action.returnToMode === 'ai' || action.returnToMode === 'agent') {
      setChatMode(action.returnToMode || chatMode);
      setChatSettingsOpen(true);
      setNimiThreadListOpen(false);
      return;
    }
    setChatMode(action.returnToMode || chatMode);
    setActiveTab('runtime');
    dispatchRuntimeConfigOpenPage(toRuntimePageId(action.targetId));
  }, [chatMode, navigate, setActiveTab, setChatMode]);

  const handleSelectTarget = useCallback((targetId: string) => {
    const target = allTargets.find((t) => t.id === targetId);
    if (!target) {
      return;
    }
    const targetMode = target.source;
    if (chatMode !== targetMode) {
      setChatMode(targetMode);
    }
    setSelectedTargetForSource(targetMode, targetId);
  }, [allTargets, chatMode, setChatMode, setSelectedTargetForSource]);

  const handleShellSelectTarget = useCallback((targetId: string | null) => {
    if (!targetId) {
      return;
    }
    handleSelectTarget(targetId);
  }, [handleSelectTarget]);

  const handleCreateGroup = useCallback(() => {
    groupCreateController.open();
  }, [groupCreateController]);

  const sharedProps = {
    allTargets,
    settingsOpen: chatSettingsOpen,
    onOpenSettings: () => {
      setChatSettingsOpen(true);
      setNimiThreadListOpen(false);
    },
    onCloseSettings: () => setChatSettingsOpen(false),
    onSetupAction: handleSetupAction,
    onSelectTarget: handleShellSelectTarget,
  } as const;
  const surfaceResetKey = [
    chatMode,
    storeSelectedTargetId ?? '',
    chatSettingsOpen ? 'settings-open' : 'settings-closed',
    nimiThreadListOpen ? 'threads-open' : 'threads-closed',
  ].join(':');

  return (
    <div data-testid={E2E_IDS.chatPage} data-chat-page-layout="split" className="relative flex min-h-0 min-w-0 flex-1">
      {chatMode === 'human' ? (
        <ChatModeSurfaceErrorBoundary
          mode="human"
          resetKey={surfaceResetKey}
          fallback={<ChatModeUnavailable mode="Human" />}
        >
          <Suspense fallback={<div className="flex min-h-0 min-w-0 flex-1" />}>
            <ChatHumanModeContent {...sharedProps} />
          </Suspense>
        </ChatModeSurfaceErrorBoundary>
      ) : null}
      {chatMode === 'ai' ? (
        <ChatModeSurfaceErrorBoundary
          mode="ai"
          resetKey={surfaceResetKey}
          fallback={<ChatModeUnavailable mode="Nimi" />}
        >
          <Suspense fallback={<div className="flex min-h-0 min-w-0 flex-1" />}>
            <ChatNimiModeContent
              {...sharedProps}
              threadListOpen={nimiThreadListOpen}
              onCloseThreadList={() => setNimiThreadListOpen(false)}
            />
          </Suspense>
        </ChatModeSurfaceErrorBoundary>
      ) : null}
      {chatMode === 'agent' ? (
        <ChatModeSurfaceErrorBoundary
          mode="agent"
          resetKey={surfaceResetKey}
          fallback={<ChatModeUnavailable mode="Agent" />}
        >
          <Suspense fallback={<div className="flex min-h-0 min-w-0 flex-1" />}>
            <ChatAgentModeContent {...sharedProps} />
          </Suspense>
        </ChatModeSurfaceErrorBoundary>
      ) : null}
      {chatMode === 'group' ? (
        <ChatModeSurfaceErrorBoundary
          mode="group"
          resetKey={surfaceResetKey}
          fallback={<ChatModeUnavailable mode="Group" />}
        >
          <Suspense fallback={<div className="flex min-h-0 min-w-0 flex-1" />}>
            <ChatGroupModeContent {...sharedProps} />
          </Suspense>
        </ChatModeSurfaceErrorBoundary>
      ) : null}
      {authStatus === 'authenticated' ? (
        <ChatContactsSidebar
          targets={allTargets}
          selectedTargetId={storeSelectedTargetId}
          activeMode={chatMode}
          onSelectTarget={(targetId) => {
            closeTransientSheets();
            handleSelectTarget(targetId);
          }}
          onCreateGroup={handleCreateGroup}
          settingsOpen={chatSettingsOpen}
          onToggleSettings={toggleChatSettings}
          nimiThreadListOpen={nimiThreadListOpen}
          onToggleNimiThreadList={toggleNimiThreadList}
        />
      ) : null}
      {groupCreateController.modal}
    </div>
  );
}
