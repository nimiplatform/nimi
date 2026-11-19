import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { Component, Suspense, lazy, useState, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ChatRelationshipRail } from './chat-relationship-rail';

function createLazyImportError(label: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error || 'unknown import error');
  const wrapped = new Error(`${label}: ${reason}`);
  wrapped.name = 'LazyImportError';
  wrapped.cause = error;
  return wrapped;
}

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

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function ChatPage() {
  const chat = useHomeChatPosition();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const authenticated = useAppStore(state => state.auth.status === 'authenticated');
  const [settings, setSettings] = useState(false);
  const [history, setHistory] = useState(false);
  const target: ConversationTargetSummary = {
    id: 'ai:assistant', source: 'ai', canonicalSessionId: 'ai:assistant', title: t('Chat.nimiAssistant'),
    handle: null, bio: null, avatarUrl: null, avatarFallback: 'AI', previewText: null,
    updatedAt: null, unreadCount: 0, status: 'active', isOnline: null, metadata: {},
  };
  return <div data-testid={E2E_IDS.chatPage} data-chat-page-layout="split" className="relative flex h-full min-h-0 min-w-0 flex-1">
    <ChatModeSurfaceErrorBoundary mode="ai" resetKey={chat.nimiSelection.threadId ?? ''}
      fallback={<div role="alert" className="m-auto px-4 text-sm">{t('Chat.contactsActionFailed')}</div>}>
      <Suspense fallback={<div className="flex h-full min-h-0 min-w-0 flex-1" />}>
        <ChatNimiModeContent allTargets={[target]} settingsOpen={settings}
          onCloseSettings={() => setSettings(false)}
          onSelectTarget={() => {}}
          onSetupAction={action => {
            if (action.kind === 'sign-in') void navigate('/login', { state: { returnToChat: true } });
            else { setSettings(true); setHistory(false); }
          }}
          threadListOpen={history} onCloseThreadList={() => setHistory(false)} />
      </Suspense>
    </ChatModeSurfaceErrorBoundary>
    {authenticated ? <ChatRelationshipRail settingsOpen={settings} nimiThreadListOpen={history}
      onToggleSettings={() => { setSettings(value => !value); setHistory(false); }}
      onToggleNimiThreadList={() => { setHistory(value => !value); setSettings(false); }} /> : null}
  </div>;
}
