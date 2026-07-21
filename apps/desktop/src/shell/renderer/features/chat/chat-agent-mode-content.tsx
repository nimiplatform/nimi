import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useAgentConversationModeHost } from './chat-agent-shell-adapter';
import { ChatAgentSceneBackground } from './chat-agent-scene-background';
import { ChatCanonicalModeFrame } from './chat-canonical-mode-frame';

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
  const [diagnosticsSectionVisible, setDiagnosticsSectionVisible] = useState(false);
  const authStatus = useAppStore((state) => state.auth.status);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const agentConversationSelection = useAppStore((state) => state.agentConversationSelection);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.agent ?? null);

  const host = useAgentConversationModeHost({
    authStatus,
    diagnosticsVisible: settingsOpen && diagnosticsSectionVisible,
    onDiagnosticsVisibilityChange: setDiagnosticsSectionVisible,
    onOpenAgentCenter: onOpenSettings,
    runtimeFields,
    selection: agentConversationSelection,
    setSelection: setAgentConversationSelection,
  });

  // Bridge sidebar target selection to host
  const prevTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (storeSelectedTargetId && storeSelectedTargetId !== prevTargetIdRef.current) {
      host.onSelectTarget?.(storeSelectedTargetId);
    }
    prevTargetIdRef.current = storeSelectedTargetId;
  }, [host, storeSelectedTargetId]);

  // Sync host selectedTargetId to store
  useEffect(() => {
    if (!host.selectedTargetId || storeSelectedTargetId) {
      return;
    }
    setSelectedTargetForSource('agent', host.selectedTargetId);
  }, [host.selectedTargetId, setSelectedTargetForSource, storeSelectedTargetId]);
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
        title: host.characterData.name || 'Agent',
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
    [allTargets, host.activeThreadId, host.characterData, selectedTargetId],
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
      className="relative flex min-h-0 min-w-0 flex-1"
      sceneBackground={sceneBackground}
      settingsSheetEyebrow={host.settingsDrawerTitle || 'Agent Center'}
      settingsSheetTitle={host.settingsDrawerSubtitle || host.characterData?.name || selectedTarget?.title}
      settingsSheetSubtitle={selectedTarget?.handle ? `~${selectedTarget.handle}` : null}
      settingsSheetWorld={host.settingsDrawerWorld ?? null}
      settingsSheetAvatarUrl={host.characterData?.avatarUrl ?? selectedTarget?.avatarUrl ?? null}
      settingsSheetAvatarFallback={host.characterData?.avatarFallback ?? selectedTarget?.avatarFallback ?? undefined}
      settingsSheetAvatarAlt={host.characterData?.name ?? selectedTarget?.title}
      settingsSheetBodyClassName="px-5 py-3"
    />
  );
}
