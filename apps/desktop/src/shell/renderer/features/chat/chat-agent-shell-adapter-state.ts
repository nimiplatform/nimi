import { useMemo } from 'react';
import { useAppStore, type AuthStatus } from '../../app-shell/providers/app-store';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import {
  overlayAgentTargetWithLiveProfileContent,
  projectCanonicalAgentTargetSnapshot,
  toConversationMessageViewModel,
} from './chat-agent-thread-model';
import type { AgentConversationSelection } from './chat-shell-types';
import { useAgentVisibleProjection } from './chat-agent-visible-projection-context.js';
import { useConversationStreamState } from './chat-shared-runtime-stream-ui';
import {
  createAgentConversationCacheThreadId,
  isEmptyPendingAssistantMessage,
  sortThreadSummaries,
} from './chat-agent-shell-core';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function synthesizeAgentThreadSummaryFromTarget(
  target: AgentLocalTargetSnapshot,
): AgentLocalThreadSummary {
  const canonicalTarget = projectCanonicalAgentTargetSnapshot(target);
  const conversationAnchorId = canonicalTarget.conversationAnchorId!;
  return {
    id: createAgentConversationCacheThreadId(conversationAnchorId),
    title: canonicalTarget.displayName,
    updatedAtMs: 0,
    lastMessageAtMs: null,
    targetSnapshot: canonicalTarget,
  };
}

type UseAgentConversationShellStateInput = {
  authStatus: AuthStatus;
  selection: AgentConversationSelection;
};

type AgentConversationShellState = {
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
  bundle: AgentLocalThreadBundle | null;
  bundleError: Error | null;
  isBundleLoading: boolean;
  messages: ReturnType<typeof toConversationMessageViewModel>[];
  selectedThreadRecord: AgentLocalThreadSummary | null;
  streamState: ReturnType<typeof useConversationStreamState>;
  targetByAgentHandle: Map<string, AgentLocalTargetSnapshot>;
  targets: AgentLocalTargetSnapshot[];
  targetsPending: boolean;
  targetsReady: boolean;
  threads: AgentLocalThreadSummary[];
  threadsReady: boolean;
};

// @nimi-authority: rule.nimi.desktop.agent-projection.r025
export function useAgentConversationShellState(
  input: UseAgentConversationShellStateInput,
): AgentConversationShellState {
  const storedTargetsByHandle = useAppStore((state) => state.agentConversationTargetByHandle);
  const targets = useMemo(
    (): AgentLocalTargetSnapshot[] => Object.values(storedTargetsByHandle).filter((target) => (
      Boolean(normalizeText(target.agentHandle)) && Boolean(normalizeText(target.conversationAnchorId))
    )),
    [storedTargetsByHandle],
  );
  const targetByAgentHandle = useMemo(
    () => new Map(targets.map((target) => [normalizeText(target.agentHandle), target])),
    [targets],
  );
  const selectedTarget = useMemo(() => {
    const target = targetByAgentHandle.get(normalizeText(input.selection.agentHandle)) || null;
    if (!target) return null;
    const selectedAnchor = normalizeText(input.selection.conversationAnchorId);
    return !selectedAnchor || selectedAnchor === normalizeText(target.conversationAnchorId) ? target : null;
  }, [input.selection.agentHandle, input.selection.conversationAnchorId, targetByAgentHandle]);
  const threads = useMemo<AgentLocalThreadSummary[]>(
    () => sortThreadSummaries(targets.map(synthesizeAgentThreadSummaryFromTarget)),
    [targets],
  );
  const selectedThreadRecord = useMemo<AgentLocalThreadSummary | null>(
    () => selectedTarget ? synthesizeAgentThreadSummaryFromTarget(selectedTarget) : null,
    [selectedTarget],
  );
  const activeThreadId = selectedThreadRecord?.id || null;
  const activeConversationAnchorId = normalizeText(selectedTarget?.conversationAnchorId) || null;
  const activeTarget = useMemo(() => {
    const threadTarget = selectedThreadRecord?.targetSnapshot || null;
    if (!threadTarget) return selectedTarget || null;
    return selectedTarget?.agentHandle === threadTarget.agentHandle
      ? overlayAgentTargetWithLiveProfileContent(threadTarget, selectedTarget)
      : threadTarget;
  }, [selectedTarget, selectedThreadRecord?.targetSnapshot]);
  const projectedBundle = useAgentVisibleProjection(activeThreadId);
  const bundle = projectedBundle || null;
  const visibleMessages = projectedBundle?.messages || [];
  const messages = useMemo(
    () => visibleMessages
      .map((message: AgentLocalMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [visibleMessages],
  );
  const streamState = useConversationStreamState(activeThreadId);

  return {
    activeTarget,
    activeThreadId,
    activeConversationAnchorId,
    bundle,
    bundleError: null,
    isBundleLoading: false,
    messages,
    selectedThreadRecord,
    streamState,
    targetByAgentHandle,
    targets,
    targetsPending: false,
    targetsReady: true,
    threads,
    threadsReady: true,
  };
}
