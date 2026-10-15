import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { type ConversationSetupAction, type ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useAgentConversationModeHost } from './chat-agent-shell-adapter';
import { ChatAgentSceneBackground } from './chat-agent-scene-background';
import { ChatCanonicalModeFrame } from './chat-canonical-mode-frame';
import { ChatAgentActivityReferences } from './chat-agent-activity-references.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { resolveDesktopOpenAgentCenterTarget } from '../../infra/desktop-open/desktop-open-intent-navigation.js';

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
  const sdk = useDesktopRendererSdk();
  const [managerPending, setManagerPending] = useState(false);
  const [managerFailed, setManagerFailed] = useState(false);
  const managerNavigation = useRef({ onOpenSettings, resolve: homeChat.resolveAgentCenterRequest });
  const managerResolved = useRef<{ agentHandle: string; conversationAnchorId: string } | null>(null);
  managerNavigation.current = { onOpenSettings, resolve: homeChat.resolveAgentCenterRequest };
  const [diagnosticsSectionVisible, setDiagnosticsSectionVisible] = useState(false);
  const authStatus = useAppStore((state) => state.auth.status);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const agentConversationSelection = homeChat.agentSelection;
  const selectAgentConversation = homeChat.selectAgentConversation;
  const storeSelectedTargetId = homeChat.targetId;
  useEffect(() => {
    if (!homeChat.managerAnchorId || authStatus !== 'authenticated') { setManagerPending(false); return; }
    let current = true;
    const anchor = homeChat.managerAnchorId;
    setManagerPending(true); setManagerFailed(false);
    void resolveDesktopOpenAgentCenterTarget(sdk.appProduct(), anchor, () => current).then((target) => {
      if (!current) return;
      setAgentConversationTargetSnapshot(target);
      managerResolved.current = { agentHandle: target.agentHandle, conversationAnchorId: anchor };
      managerNavigation.current.resolve({ agentHandle: target.agentHandle, conversationAnchorId: anchor, targetId: target.agentHandle });
    }).catch(() => {
      if (!current) return;
      setManagerFailed(true); managerNavigation.current.resolve(null);
    }).finally(() => { if (current) setManagerPending(false); });
    return () => { current = false; };
  }, [homeChat.managerAnchorId, authStatus, sdk, setAgentConversationTargetSnapshot]);
  // Open after the proven selection is rendered. ChatPage closes transient
  // sheets in its layout effect when the selected Agent changes.
  useEffect(() => {
    const target = managerResolved.current;
    if (!target || homeChat.managerAnchorId) return;
    managerResolved.current = null;
    if (authStatus === 'authenticated' && target.agentHandle === agentConversationSelection.agentHandle
      && target.conversationAnchorId === agentConversationSelection.conversationAnchorId) managerNavigation.current.onOpenSettings();
  }, [homeChat.managerAnchorId, agentConversationSelection.agentHandle, agentConversationSelection.conversationAnchorId, authStatus]);

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
    <>
    {managerPending ? <p role="status" className="px-4 py-2 text-sm">{t('Chat.agentCenterOpenPending')}</p> : null}
    {managerFailed ? <InlineAlert tone="warning" className="mx-4 my-2">{t('Chat.agentCenterOpenFailed')} <Button tone="ghost" size="sm" onClick={() => setManagerFailed(false)}>{t('Chat.agentCenterNoticeDismiss')}</Button></InlineAlert> : null}
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
    </>
  );
}
