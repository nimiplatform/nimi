import { useEffect, useMemo, useRef } from 'react';
import {
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useHumanConversationModeHost } from './chat-human-adapter';
import { ChatCanonicalModeFrame } from './chat-canonical-mode-frame';

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
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setChatProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const lastSelectedHumanThread = useAppStore((state) => state.lastSelectedThreadByMode.human ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.human ?? null);

  const host = useHumanConversationModeHost({
    authStatus,
    selectedChatId,
    setSelectedChatId,
    setChatProfilePanelTarget,
  });

  // Bridge sidebar target selection to host
  const prevTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (storeSelectedTargetId && storeSelectedTargetId !== prevTargetIdRef.current) {
      host.onSelectTarget?.(storeSelectedTargetId);
    }
    prevTargetIdRef.current = storeSelectedTargetId;
  }, [host, storeSelectedTargetId]);

  // Restore lastSelectedHumanThread on mount
  useEffect(() => {
    if (selectedChatId || !lastSelectedHumanThread) {
      return;
    }
    setSelectedChatId(lastSelectedHumanThread);
  }, [lastSelectedHumanThread, selectedChatId, setSelectedChatId]);

  // Sync host selectedTargetId to store
  useEffect(() => {
    if (!host.selectedTargetId || storeSelectedTargetId) {
      return;
    }
    setSelectedTargetForSource('human', host.selectedTargetId);
  }, [host.selectedTargetId, setSelectedTargetForSource, storeSelectedTargetId]);

  const selectedTargetId = storeSelectedTargetId || host.selectedTargetId || null;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
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
