import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useMemo } from 'react';
import { type ConversationSetupAction, type ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useHumanConversationModeHost } from './chat-human-adapter';
import { ChatCanonicalModeFrame } from './chat-canonical-mode-frame';
import { chatSidebarQueryAuthStatus } from './chat-sidebar-targets.js';

export type ChatHumanModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatHumanModeContent({
  allTargets,
  settingsOpen,
  onCloseSettings,
  onSetupAction,
  onSelectTarget,
}: ChatHumanModeContentProps) {
  const homeChat = useHomeChatPosition();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore(state => String(state.auth.user?.id ?? ''));
  const selectedChatId = homeChat.humanThreadId;
  const setChatProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const storeSelectedTargetId = homeChat.targetId;

  const host = useHumanConversationModeHost({
    authStatus: chatSidebarQueryAuthStatus(authStatus, ownerUserId),
    selectedChatId,
    setSelectedChatId: homeChat.resolveHumanThread,
    onOpenThread: threadId => homeChat.open({ mode: 'human', threadId }),
    setChatProfilePanelTarget,
  });

  const selectedTargetId = storeSelectedTargetId || host.selectedTargetId || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || host.targets?.find(target => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId, host.targets],
  );

  return (
    <ChatCanonicalModeFrame
      mode="human"
      host={host}
      allTargets={allTargets}
      selectedTargetId={selectedTargetId}
      selectedTarget={selectedTarget}
      onSelectTarget={onSelectTarget}
      onSetupAction={onSetupAction}
      settingsOpen={settingsOpen}
      onCloseSettings={onCloseSettings}
      settingsSheetTitle={host.settingsDrawerTitle || t('Chat.settingsTitle', { defaultValue: 'Settings' })}
      settingsSheetSubtitle={host.settingsDrawerSubtitle || host.characterData?.name || selectedTarget?.title}
    />
  );
}
