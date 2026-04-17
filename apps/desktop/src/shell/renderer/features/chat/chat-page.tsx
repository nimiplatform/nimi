import { useCallback, useEffect, useState } from 'react';
import type { ConversationSetupAction } from '@nimiplatform/nimi-kit/features/chat';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { dispatchRuntimeConfigOpenPage } from '@renderer/features/runtime-config/runtime-config-navigation-events';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ChatContactsSidebar } from './chat-contacts-sidebar';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { useChatTargetsForSidebar } from './chat-sidebar-targets';
import { ChatHumanModeContent } from './chat-human-mode-content';
import { ChatAiModeContent } from './chat-ai-mode-content';
import { ChatAgentModeContent } from './chat-agent-mode-content';
import { ChatGroupModeContent } from './chat-group-mode-content';
import { GROUP_CREATE_INTENT_TARGET_ID } from './chat-group-flow-constants';

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
      <DesktopIconToggleAction
        icon={props.icon}
        active={props.active}
        disabled={props.disabled}
        onClick={props.disabled ? undefined : props.onClick}
        aria-label={props.tooltip}
        title={props.tooltip}
        className="h-9 w-9"
      />
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
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [rightPanelMode, setRightPanelMode] = useState<'auto' | 'settings'>('auto');
  const [rightPanelFolded, setRightPanelFolded] = useState(false);

  const allTargets = useChatTargetsForSidebar(authStatus);

  const toggleRightPanelFold = useCallback(() => {
    setRightPanelFolded((prev) => !prev);
  }, []);

  const toggleRightPanelSettings = useCallback(() => {
    setRightPanelMode((prev) => (prev === 'settings' ? 'auto' : 'settings'));
  }, []);

  // If selected target disappeared (e.g. logout), clear it
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

  // Close transient panels on target/mode change
  useEffect(() => {
    setRightPanelMode('auto');
  }, [chatMode, storeSelectedTargetId]);

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
      setRightPanelMode('settings');
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
    rightPanelMode,
    rightPanelFolded,
    onToggleRightPanelFold: toggleRightPanelFold,
    onToggleRightPanelSettings: toggleRightPanelSettings,
    onSetupAction: handleSetupAction,
    onSelectTarget: handleShellSelectTarget,
  } as const;

  return (
    <div data-testid={E2E_IDS.chatPage} data-chat-page-layout="split" className="relative flex min-h-0 min-w-0 flex-1">
      {chatMode === 'human' ? <ChatHumanModeContent {...sharedProps} /> : null}
      {chatMode === 'ai' ? <ChatAiModeContent {...sharedProps} /> : null}
      {chatMode === 'agent' ? <ChatAgentModeContent {...sharedProps} /> : null}
      {chatMode === 'group' ? <ChatGroupModeContent {...sharedProps} /> : null}
      {rightPanelFolded ? (
        <FoldedPanelFloatingBar
          onUnfold={toggleRightPanelFold}
          onToggleSettings={() => {
            setRightPanelFolded(false);
            setRightPanelMode('settings');
          }}
        />
      ) : null}
      {authStatus === 'authenticated' ? (
        <ChatContactsSidebar
          targets={allTargets}
          selectedTargetId={storeSelectedTargetId}
          onSelectTarget={handleSelectTarget}
          onCreateGroup={handleCreateGroup}
        />
      ) : null}
    </div>
  );
}
