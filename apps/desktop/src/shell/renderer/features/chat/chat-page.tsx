import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import type { ConversationSetupAction } from '@nimiplatform/kit/features/chat/headless';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ChatRelationshipRail } from './chat-relationship-rail';
import { LocalAgentManagementDialog } from '../agents/local-agent-management-dialog.js';
import { DESKTOP_NIMI_APP_ID } from './chat-nimi-app-ai-config';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { openOrCreateRuntimeSetupTask } from '../runtime-config/runtime-setup-task-open.js';
import { currentDesktopAccountIdForSetup } from '../runtime-config/runtime-setup-task-ports.js';
import { openAgentTargetSnapshotFromSummary, useChatTargetsForSidebar } from './chat-sidebar-targets';

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
    Human: 'Human mode is temporarily unavailable. Switch to another conversation mode or reopen the app.',
    Nimi: 'Nimi mode is temporarily unavailable. Switch to another conversation mode or reopen the app.',
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--nimi-text-secondary)]">
      {copyByMode[mode] ?? `${mode} mode is temporarily unavailable. Switch to another conversation mode or reopen the app.`}
    </div>
  );
}

export function ChatPage() {
  const homeChat = useHomeChatPosition();
  const navigation = useHomeNavigation();
  const sdk = useDesktopRendererSdk();
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const navigate = useNavigate();
  const authStatus = useAppStore((state) => state.auth.status);
  const chatMode = homeChat.mode;
  const storeSelectedTargetId = homeChat.targetId;
  const openChatMode = homeChat.openMode;

  const selectAgentConversation = homeChat.selectAgentConversation;
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const agentConversationTargetByHandle = useAppStore((state) => state.agentConversationTargetByHandle);

  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [agentManagementOpen,setAgentManagementOpen]=useState(false);
  const [nimiThreadListOpen, setNimiThreadListOpen] = useState(false);

  const allTargets = useChatTargetsForSidebar(authStatus);

  useEffect(() => {
    if (chatMode !== 'agent' || !storeSelectedTargetId) {
      return;
    }
    const selected = allTargets.find((target) => (
      target.source === 'agent' && target.id === storeSelectedTargetId
    ));
    const existing = selected
      ? agentConversationTargetByHandle[String(selected.metadata?.agentHandle || '').trim()]
      : null;
    if (existing?.agentHandle && existing.conversationAnchorId) {
      selectAgentConversation({
        agentHandle: existing.agentHandle,
        conversationAnchorId: existing.conversationAnchorId,
        targetId: existing.agentHandle,
      });
      return;
    }
    let cancelled = false;
    void openAgentTargetSnapshotFromSummary(selected, sdk.conversation()).then((snapshot) => {
      if (!cancelled && snapshot) {
        setAgentConversationTargetSnapshot(snapshot);
        selectAgentConversation({
          agentHandle: snapshot.agentHandle || null,
          conversationAnchorId: snapshot.conversationAnchorId || null,
          targetId: snapshot.agentHandle || null,
        });
      }
    }).catch((error) => {
      if (cancelled) return;
      logRendererEvent({
        level: 'warn', area: 'chat', message: 'action:canonical-agent-open:failed',
        details: { error: error instanceof Error ? error.message : String(error || '') },
      });
    });
    return () => { cancelled = true; };
  }, [
    allTargets,
    agentConversationTargetByHandle,
    chatMode,

    setAgentConversationTargetSnapshot,
    sdk,
    storeSelectedTargetId,
  ]);

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

  useLayoutEffect(() => {
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
      openChatMode(action.returnToMode || chatMode);
      void navigate('/login', {
        state: { returnToChat: true },
      });
      return;
    }
    if (chatMode === 'ai' || chatMode === 'agent' || action.returnToMode === 'ai' || action.returnToMode === 'agent') {
      openChatMode(action.returnToMode || chatMode);
      setChatSettingsOpen(true);
      setNimiThreadListOpen(false);
      return;
    }
    openChatMode(action.returnToMode || chatMode);
    // The conversation setup action opens the shared setup task for the exact
    // Nimi app owner instead of the legacy overview page; the original input
    // is never re-sent.
    void currentDesktopAccountIdForSetup().then((accountId) => {
      openOrCreateRuntimeSetupTask(getRuntimeSetupTaskStore(), {
        capabilityContract: 'text.generate',
        source: {
          kind: 'app',
          ownerAppId: DESKTOP_NIMI_APP_ID,
          accountId,
          returnFocus: 'chat',
        },
        openTask: (taskId) => {

          runtimeConfigNavigation.openSetupTask(taskId);
        },
      });
    });
  }, [chatMode, navigate, runtimeConfigNavigation, navigation, openChatMode]);

  const handleSelectTarget = useCallback((targetId: string) => {
    const target = allTargets.find((t) => t.id === targetId);
    if (!target) {
      return;
    }
    const targetMode = target.source;
    if (targetMode === 'agent') {
      const entry = navigation.getSnapshot().current.key;
      void openAgentTargetSnapshotFromSummary(target, sdk.conversation()).then((agentSnapshot) => {
        if (!agentSnapshot?.agentHandle || !agentSnapshot.conversationAnchorId || navigation.getSnapshot().current.key !== entry) return;
        setAgentConversationTargetSnapshot(agentSnapshot);
        homeChat.open({ mode: 'agent',
          agentHandle: agentSnapshot.agentHandle,
          conversationAnchorId: agentSnapshot.conversationAnchorId,
          targetId: agentSnapshot.agentHandle,
        });
      }).catch((error: unknown) => {
        logRendererEvent({
          level: 'warn', area: 'chat', message: 'action:canonical-agent-open:failed',
          details: { error: error instanceof Error ? error.message : String(error || '') },
        });
      });
      return;
    }
    homeChat.open({ mode: targetMode, targetId, ...(targetMode === 'human' && target.canonicalSessionId ? { threadId: target.canonicalSessionId } : {}) });
  }, [
    allTargets,
    homeChat.open,
    navigation,

    setAgentConversationTargetSnapshot,

    sdk,
  ]);

  const handleShellSelectTarget = useCallback((targetId: string | null) => {
    if (!targetId) {
      return;
    }
    handleSelectTarget(targetId);
  }, [handleSelectTarget]);

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
    <div data-testid={E2E_IDS.chatPage} data-chat-page-layout="split" className="relative flex h-full min-h-0 min-w-0 flex-1">
      {chatMode === 'human' ? (
        <ChatModeSurfaceErrorBoundary
          mode="human"
          resetKey={surfaceResetKey}
          fallback={<ChatModeUnavailable mode="Human" />}
        >
          <Suspense fallback={<div className="flex h-full min-h-0 min-w-0 flex-1" />}>
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
          <Suspense fallback={<div className="flex h-full min-h-0 min-w-0 flex-1" />}>
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
          <Suspense fallback={<div className="flex h-full min-h-0 min-w-0 flex-1" />}>
            <ChatAgentModeContent {...sharedProps} />
          </Suspense>
        </ChatModeSurfaceErrorBoundary>
      ) : null}
      {authStatus === 'authenticated' ? (
        <ChatRelationshipRail
          targets={allTargets}
          selectedTargetId={storeSelectedTargetId}
          activeMode={chatMode}
          onSelectTarget={(targetId) => {
            closeTransientSheets();
            handleSelectTarget(targetId);
          }}
          settingsOpen={chatSettingsOpen}
          onToggleSettings={toggleChatSettings}
          nimiThreadListOpen={nimiThreadListOpen}
          onToggleNimiThreadList={toggleNimiThreadList}
          onManageAgents={()=>setAgentManagementOpen(true)}
        />
      ) : null}
      {authStatus==='authenticated'&&agentManagementOpen?<LocalAgentManagementDialog open onOpenChange={setAgentManagementOpen}/>:null}
    </div>
  );
}
