import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useEffect, useMemo, useState } from 'react';
import { type ConversationSetupAction, type ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useAgentConversationModeHost } from './chat-agent-shell-adapter';
import { ChatAgentSceneBackground } from './chat-agent-scene-background';
import { ChatCanonicalModeFrame } from './chat-canonical-mode-frame';
import { ChatAgentActivityReferences } from './chat-agent-activity-references.js';

export type ChatAgentModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatAgentModeContent({
  allTargets,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onSetupAction,
  onSelectTarget,
}: ChatAgentModeContentProps) {
  const homeChat = useHomeChatPosition();
  const { t } = useTranslation();
  const [diagnosticsSectionVisible, setDiagnosticsSectionVisible] = useState(false);
  const authStatus = useAppStore((state) => state.auth.status);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const agentConversationSelection = homeChat.agentSelection;
  const selectAgentConversation = homeChat.selectAgentConversation;
  const storeSelectedTargetId = homeChat.targetId;

  const host = useAgentConversationModeHost({
    authStatus,
    diagnosticsVisible: settingsOpen && diagnosticsSectionVisible,
    onDiagnosticsVisibilityChange: setDiagnosticsSectionVisible,
    onOpenAgentCenter: onOpenSettings,
    onCloseAgentCenter: onCloseSettings,
    agentCenterOpen: settingsOpen,
    runtimeFields,
    selection: agentConversationSelection,
    setSelection: selectAgentConversation,
  });

  useEffect(() => {
    if (settingsOpen) {
      return;
    }
    setDiagnosticsSectionVisible(false);
  }, [settingsOpen]);

  const selectedTargetId = storeSelectedTargetId || host.selectedTargetId || null;
  const selectedTarget = useMemo(
    () => {
      if (!selectedTargetId) {
        return null;
      }
      const sidebarTarget = allTargets.find((target) => target.id === selectedTargetId) || null;
      if (sidebarTarget) {
        return sidebarTarget;
      }
      if (!host.characterData) {
        return null;
      }
      return {
        id: selectedTargetId,
        source: 'agent' as const,
        canonicalSessionId: host.activeThreadId || selectedTargetId,
        title: host.characterData.name || t('Chat.agentGenericIdentity', { defaultValue: 'Partner' }),
        handle: host.characterData.handle || null,
        bio: null,
        avatarUrl: host.characterData.avatarUrl || null,
        avatarFallback: (host.characterData.name || 'A').charAt(0).toUpperCase(),
        previewText: null,
        updatedAt: null,
        unreadCount: 0,
        status: 'active' as const,
        isOnline: null,
        metadata: {},
      };
    },
    [allTargets, host.activeThreadId, host.characterData, selectedTargetId, t],
  );

  const sceneBackground = selectedTarget ? (
    <ChatAgentSceneBackground
      characterData={host.characterData}
    />
  ) : null;

  return (
    <ChatCanonicalModeFrame
      mode="agent"
      host={host}
      allTargets={allTargets}
      selectedTargetId={selectedTargetId}
      selectedTarget={selectedTarget}
      onSelectTarget={onSelectTarget}
      onSetupAction={onSetupAction}
      settingsOpen={settingsOpen}
      onCloseSettings={onCloseSettings}
      className="relative"
      sceneBackground={sceneBackground}
      settingsSheetBare
      transcriptPropsOverride={{
        ...host.transcriptProps,
        footerContent: <>
          {host.transcriptProps?.footerContent}
          <ChatAgentActivityReferences agentHandle={agentConversationSelection.agentHandle} />
        </>,
      }}
    />
  );
}
