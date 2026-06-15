import { useEffect, useMemo, useRef } from 'react';
import {
  type ConversationSetupAction,
  type ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useGroupConversationModeHost } from './chat-group-adapter';
import {
  useGroupCanonicalStagePanelProps,
  useGroupCanonicalTranscriptProps,
} from './chat-group-canonical-components';
import { ChatCanonicalModeFrame } from './chat-canonical-mode-frame';

export type ChatGroupModeContentProps = {
  allTargets: readonly ConversationTargetSummary[];
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  onSelectTarget: (targetId: string | null) => void;
};

export function ChatGroupModeContent({
  allTargets,
  settingsOpen,
  onCloseSettings,
  onSetupAction,
  onSelectTarget,
}: ChatGroupModeContentProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUserId = useAppStore((state) => {
    const user = state.auth.user;
    return user ? String((user as Record<string, unknown>).id || (user as Record<string, unknown>).accountId || '') : null;
  });
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const lastSelectedGroupThread = useAppStore((state) => state.lastSelectedThreadByMode.group ?? null);
  const storeSelectedTargetId = useAppStore((state) => state.selectedTargetBySource.group ?? null);

  const host = useGroupConversationModeHost({
    authStatus,
    currentUserId,
  });

  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current || allTargets.length === 0) {
      return;
    }
    if (storeSelectedTargetId || !lastSelectedGroupThread) {
      restoreAttemptedRef.current = true;
      return;
    }
    const targetExists = allTargets.some((target) => target.id === lastSelectedGroupThread && target.source === 'group');
    restoreAttemptedRef.current = true;
    if (!targetExists) {
      return;
    }
    setSelectedTargetForSource('group', lastSelectedGroupThread);
  }, [
    allTargets,
    lastSelectedGroupThread,
    setSelectedTargetForSource,
    storeSelectedTargetId,
  ]);

  const selectedTargetId = storeSelectedTargetId;
  const selectedTarget = useMemo(
    () => selectedTargetId
      ? allTargets.find((target) => target.id === selectedTargetId) || null
      : null,
    [allTargets, selectedTargetId],
  );

  const transcriptProps = useGroupCanonicalTranscriptProps();
  const stagePanelProps = useGroupCanonicalStagePanelProps();

  return (
    <ChatCanonicalModeFrame
      mode="group"
      host={host}
      allTargets={allTargets}
      selectedTargetId={selectedTargetId}
      selectedTarget={selectedTarget}
      onSelectTarget={onSelectTarget}
      onSetupAction={onSetupAction}
      settingsOpen={settingsOpen}
      onCloseSettings={onCloseSettings}
      transcriptPropsOverride={transcriptProps}
      stagePanelPropsOverride={stagePanelProps}
      settingsSheetTitle={host.settingsDrawerTitle || 'Group'}
      settingsSheetSubtitle={host.characterData?.bio || selectedTarget?.title}
      settingsSheetContent={host.rightPanelContent ?? (
        <p className="text-sm text-slate-500">
          Group settings are not available for this conversation yet.
        </p>
      )}
    />
  );
}
