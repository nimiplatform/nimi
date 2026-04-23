import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ConversationSetupAction } from '@nimiplatform/nimi-kit/features/chat';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dispatchRuntimeConfigOpenPage } from '@renderer/features/runtime-config/runtime-config-navigation-events';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ChatContactsSidebar } from './chat-contacts-sidebar';
import { useChatTargetsForSidebar } from './chat-sidebar-targets';
import { ChatHumanModeContent } from './chat-human-mode-content';
import { ChatNimiModeContent } from './chat-nimi-mode-content';
import { ChatGroupModeContent } from './chat-group-mode-content';
import { GROUP_CREATE_INTENT_TARGET_ID } from './chat-group-flow-constants';

const ChatAgentModeContent = lazy(async () => {
  const mod = await import('./chat-agent-mode-content');
  return { default: mod.ChatAgentModeContent };
});

type ChatModeSurfaceErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
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

  override componentDidCatch(error: Error): void {
    logRendererEvent({
      level: 'error',
      area: 'chat',
      message: 'action:chat-mode-surface:failed',
      details: {
        chatMode: 'agent',
        error: error.message,
      },
    });
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
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
  const groupSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.group ?? null);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [nimiThreadListOpen, setNimiThreadListOpen] = useState(false);

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
    if (chatMode === 'group' && storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID) {
      return;
    }
    const targetExists = allTargets.some((target) => target.id === storeSelectedTargetId);
    if (targetExists) {
      return;
    }
    if (authStatus !== 'authenticated') {
      setChatMode('ai');
      setSelectedTargetForSource('ai', 'ai:assistant');
    } else {
      setSelectedTargetForSource(chatMode, null);
    }
  }, [allTargets, authStatus, chatMode, setChatMode, setSelectedTargetForSource, storeSelectedTargetId]);

  useEffect(() => {
    if (chatMode === 'group' || groupSelectedTargetId !== GROUP_CREATE_INTENT_TARGET_ID) {
      return;
    }
    setSelectedTargetForSource('group', null);
  }, [chatMode, groupSelectedTargetId, setSelectedTargetForSource]);

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
    setChatMode('group');
    setSelectedTargetForSource('group', GROUP_CREATE_INTENT_TARGET_ID);
  }, [setChatMode, setSelectedTargetForSource]);

  const sharedProps = {
    allTargets,
    settingsOpen: chatSettingsOpen,
    onCloseSettings: () => setChatSettingsOpen(false),
    onSetupAction: handleSetupAction,
    onSelectTarget: handleShellSelectTarget,
  } as const;

  return (
    <div data-testid={E2E_IDS.chatPage} data-chat-page-layout="split" className="relative flex min-h-0 min-w-0 flex-1">
      {chatMode === 'human' ? <ChatHumanModeContent {...sharedProps} /> : null}
      {chatMode === 'ai' ? (
        <ChatNimiModeContent
          {...sharedProps}
          threadListOpen={nimiThreadListOpen}
          onCloseThreadList={() => setNimiThreadListOpen(false)}
        />
      ) : null}
      {chatMode === 'agent' ? (
        <ChatModeSurfaceErrorBoundary
          fallback={(
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--nimi-text-secondary)]">
              Agent mode is temporarily unavailable. Switch to another conversation mode or reopen the app.
            </div>
          )}
        >
          <Suspense fallback={<div className="flex min-h-0 min-w-0 flex-1" />}>
            <ChatAgentModeContent {...sharedProps} />
          </Suspense>
        </ChatModeSurfaceErrorBoundary>
      ) : null}
      {chatMode === 'group' ? <ChatGroupModeContent {...sharedProps} /> : null}
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
    </div>
  );
}
