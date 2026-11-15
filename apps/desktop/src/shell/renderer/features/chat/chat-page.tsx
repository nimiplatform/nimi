import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import type { ConversationSetupAction } from '@nimiplatform/kit/features/chat/headless';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ChatRelationshipRail } from './chat-relationship-rail';
import { useChatSidebarData } from './chat-sidebar-targets';
import { createChatTargetNavigation } from './chat-target-navigation.js';
import { useRealmHumanChatData } from './data/realm-human-chat-data-context.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';

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
  const humanChatData = useRealmHumanChatData();
  const navigate = useNavigate();
  const authStatus = useAppStore((state) => state.auth.status);
  const chatMode = homeChat.mode;
  const storeSelectedTargetId = homeChat.targetId;

  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [nimiThreadListOpen, setNimiThreadListOpen] = useState(false);
  const { targets } = useChatSidebarData(authStatus);
  const allTargets = useMemo(() => targets.filter(target => target.source === (chatMode === 'human' ? 'human' : 'ai')), [targets, chatMode]);
  const toggleChatSettings = useCallback(() => {
    setChatSettingsOpen(!chatSettingsOpen);
    setNimiThreadListOpen(false);
  }, [chatSettingsOpen, setChatSettingsOpen]);

  const toggleNimiThreadList = useCallback(() => {
    setNimiThreadListOpen((current) => {
      const next = !current;
      if (next) {
        setChatSettingsOpen(false);
      }
      return next;
    });
  }, [setChatSettingsOpen]);

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
    if (action.kind === 'sign-in') { void navigate('/login', { state: { returnToChat: chatMode === 'ai' } }); return; }
    setChatSettingsOpen(true); setNimiThreadListOpen(false);
  }, [navigate, chatMode]);
  const targetNavigation = useRef<ReturnType<typeof createChatTargetNavigation> | null>(null);
  useEffect(() => {
    const controller = createChatTargetNavigation({
      navigation,
      openHuman: async accountId => {
        const result = await humanChatData.startChatWithTarget(accountId);
        const chatId = result?.chatId || result?.chat?.id;
        if (!chatId) throw new Error('Chat could not be opened.');
        return chatId;
      },
      onError: error => {
        emitFeedbackToast({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        logRendererEvent({ level: 'warn', area: 'chat', message: 'action:human-chat-open:failed',
          details: { error: error instanceof Error ? error.message : String(error) } });
      },
    });
    targetNavigation.current = controller;
    return () => { controller.dispose(); };
  }, [navigation, humanChatData, authStatus]);

  const handleSelectTarget = useCallback((targetId: string) => {
    const target = allTargets.find((t) => t.id === targetId);
    if (!target) {
      return;
    }
    setNimiThreadListOpen(false);
    void targetNavigation.current?.select(target);
  }, [allTargets]);

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
      {authStatus === 'authenticated' ? (
        <ChatRelationshipRail
          targets={allTargets}
          selectedTargetId={storeSelectedTargetId ?? (chatMode === 'human' && homeChat.humanThreadId
            ? allTargets.find(target => target.source === 'human' && target.canonicalSessionId === homeChat.humanThreadId)?.id ?? null : null)}
          activeMode={chatMode}
          onSelectTarget={handleSelectTarget}
          settingsOpen={chatSettingsOpen}
          onToggleSettings={toggleChatSettings}
          nimiThreadListOpen={nimiThreadListOpen}
          onToggleNimiThreadList={toggleNimiThreadList}
        />
      ) : null}
    </div>
  );
}
