import {
  useCallback,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RouteModelPickerSelection } from '@nimiplatform/kit/features/model-picker';
import {
  findNimiRuntimeRouteModelProfile,
} from '@nimiplatform/sdk/runtime';
import { useAppStore, type AuthStatus } from '@renderer/app-shell/providers/app-store';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import {
  overlayAgentTargetWithLiveProfileContent,
  toConversationMessageViewModel,
} from './chat-agent-thread-model';
import type { AgentConversationSelection } from './chat-shell-types';
import { useAgentVisibleProjection } from './chat-agent-visible-projection-store';
import { useConversationStreamState } from './chat-shared-runtime-stream-ui';
import {
  getAgentConversationAnchorBinding,
  getAgentConversationAnchorBindingVersion,
  subscribeAgentConversationAnchorBindings,
} from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import {
  createAgentConversationCacheThreadId,
  isEmptyPendingAssistantMessage,
  sortThreadSummaries,
} from './chat-agent-shell-core';
import {
  listRuntimeAgentConversationSummaries,
  RUNTIME_AGENT_CONVERSATION_SUMMARIES_QUERY_KEY,
  type AgentRuntimeConversationSummary,
} from './chat-agent-runtime-conversation-summaries';
import {
  type NimiAIConfig,
} from './conversation-capability';
import { loadDesktopRouteOptions } from '../runtime-config/desktop-route-options-service';

function synthesizeAgentThreadSummaryFromRuntimeSummary(
  summary: AgentRuntimeConversationSummary,
): AgentLocalThreadSummary {
  return {
    id: createAgentConversationCacheThreadId(summary.localAgentRef),
    ownerUserId: summary.ownerUserId,
    runtimeSourceRef: summary.runtimeSourceRef,
    localAgentRef: summary.localAgentRef,
    title: summary.title,
    updatedAtMs: summary.updatedAtMs,
    lastMessageAtMs: summary.updatedAtMs || null,
    targetSnapshot: summary.targetSnapshot,
  };
}

function synthesizeAgentThreadSummaryFromTarget(
  target: AgentLocalTargetSnapshot,
): AgentLocalThreadSummary {
  return {
    id: createAgentConversationCacheThreadId(target.localAgentRef),
    ownerUserId: target.ownerUserId,
    runtimeSourceRef: target.runtimeSourceRef,
    localAgentRef: target.localAgentRef,
    title: target.displayName,
    updatedAtMs: 0,
    lastMessageAtMs: null,
    targetSnapshot: target,
  };
}

type UseAgentConversationShellStateInput = {
  aiConfig: NimiAIConfig;
  authStatus: AuthStatus;
  bootstrapReady: boolean;
  selection: AgentConversationSelection;
};

type AgentConversationShellState = {
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
  agentResolution: ReturnType<typeof useAppStore.getState>['agentEffectiveCapabilityResolution'];
  agentRouteReady: boolean;
  bundle: AgentLocalThreadBundle | null;
  bundleError: Error | null;
  handleModelSelectionChange: (selection: RouteModelPickerSelection) => void;
  initialModelSelection: Partial<RouteModelPickerSelection>;
  isBundleLoading: boolean;
  messages: ReturnType<typeof toConversationMessageViewModel>[];
  runtimeConversationSummaries: AgentRuntimeConversationSummary[];
  runtimeConversationSummariesReady: boolean;
  selectedThreadRecord: AgentLocalThreadSummary | null;
  streamState: ReturnType<typeof useConversationStreamState>;
  targetByLocalAgentRef: Map<string, AgentLocalTargetSnapshot>;
  targets: AgentLocalTargetSnapshot[];
  targetsPending: boolean;
  targetsReady: boolean;
  textRouteModelProfile: ReturnType<typeof findNimiRuntimeRouteModelProfile>;
  threads: AgentLocalThreadSummary[];
  threadsReady: boolean;
};

export function useAgentConversationShellState(
  input: UseAgentConversationShellStateInput,
): AgentConversationShellState {
  const agentResolution = useAppStore((state) => state.agentEffectiveCapabilityResolution);
  const textRouteOptionsQuery = useQuery({
    queryKey: ['chat-agent-route-options', 'text.generate'],
    queryFn: () => loadDesktopRouteOptions('text.generate'),
    enabled: input.bootstrapReady,
    staleTime: 60_000,
  });
  const textRouteModelProfile = useMemo(
    () => findNimiRuntimeRouteModelProfile(textRouteOptionsQuery.data, null),
    [textRouteOptionsQuery.data],
  );

  const handleModelSelectionChange = useCallback((selection: RouteModelPickerSelection) => {
    void selection;
  }, []);

  const initialModelSelection = useMemo<Partial<RouteModelPickerSelection>>(() => {
    return {};
  }, []);

  const storedTargetsByLocalRef = useAppStore((state) => state.agentConversationTargetByLocalRef);
  const targets = useMemo(
    (): AgentLocalTargetSnapshot[] => Object.values(storedTargetsByLocalRef),
    [storedTargetsByLocalRef],
  );
  const targetByLocalAgentRef = useMemo(
    () => new Map(targets.map((target) => [target.localAgentRef, target])),
    [targets],
  );
  const runtimeConversationSummaryTargetKey = useMemo(
    () => targets.map((target) => target.localAgentRef).sort().join('|'),
    [targets],
  );
  const runtimeConversationSummariesQuery = useQuery({
    queryKey: [
      ...RUNTIME_AGENT_CONVERSATION_SUMMARIES_QUERY_KEY,
      runtimeConversationSummaryTargetKey,
    ],
    queryFn: () => listRuntimeAgentConversationSummaries(targets),
    enabled: input.authStatus === 'authenticated' && targets.length > 0,
    staleTime: 60_000,
  });
  const runtimeConversationSummaries = useMemo(
    () => (targets.length === 0 ? [] : runtimeConversationSummariesQuery.data || []),
    [runtimeConversationSummariesQuery.data, targets.length],
  );
  const runtimeConversationSummariesReady = targets.length === 0
    ? true
    : runtimeConversationSummariesQuery.isSuccess;

  const selectedTarget = useMemo(
    () => targetByLocalAgentRef.get(input.selection.localAgentRef || '') || null,
    [input.selection.localAgentRef, targetByLocalAgentRef],
  );
  const runtimeConversationSummaryByLocalAgentRef = useMemo(
    () => new Map(runtimeConversationSummaries.map((summary) => [summary.localAgentRef, summary])),
    [runtimeConversationSummaries],
  );
  const threads = useMemo<AgentLocalThreadSummary[]>(
    () => sortThreadSummaries(
      runtimeConversationSummaries.map((summary) => synthesizeAgentThreadSummaryFromRuntimeSummary(summary)),
    ),
    [runtimeConversationSummaries],
  );
  const selectedThreadRecord = useMemo<AgentLocalThreadSummary | null>(() => {
    if (!selectedTarget) {
      return null;
    }
    const runtimeSummary = runtimeConversationSummaryByLocalAgentRef.get(selectedTarget.localAgentRef) || null;
    if (runtimeSummary) {
      return synthesizeAgentThreadSummaryFromRuntimeSummary(runtimeSummary);
    }
    return synthesizeAgentThreadSummaryFromTarget(selectedTarget);
  }, [runtimeConversationSummaryByLocalAgentRef, selectedTarget]);
  const activeThreadId = selectedThreadRecord?.id || null;
  const anchorBindingVersion = useSyncExternalStore(
    subscribeAgentConversationAnchorBindings,
    getAgentConversationAnchorBindingVersion,
    getAgentConversationAnchorBindingVersion,
  );
  const activeAnchorBindingLocalAgentRef = selectedTarget?.localAgentRef
    || selectedThreadRecord?.localAgentRef
    || input.selection.localAgentRef
    || null;
  const activeConversationAnchorId = useMemo(() => {
    if (!activeAnchorBindingLocalAgentRef) {
      return null;
    }
    const runtimeSummary = runtimeConversationSummaryByLocalAgentRef.get(activeAnchorBindingLocalAgentRef) || null;
    if (runtimeSummary?.conversationAnchorId) {
      return runtimeSummary.conversationAnchorId;
    }
    return getAgentConversationAnchorBinding(activeAnchorBindingLocalAgentRef)?.conversationAnchorId || null;
  }, [activeAnchorBindingLocalAgentRef, anchorBindingVersion, runtimeConversationSummaryByLocalAgentRef]);
  const activeTarget = useMemo(() => {
    const threadTarget = selectedThreadRecord?.targetSnapshot || null;
    if (!threadTarget) {
      return selectedTarget || null;
    }
    if (selectedTarget?.localAgentRef === threadTarget.localAgentRef) {
      return overlayAgentTargetWithLiveProfileContent(threadTarget, selectedTarget);
    }
    return threadTarget;
  }, [selectedTarget, selectedThreadRecord?.targetSnapshot]);
  const agentRouteReady = agentResolution?.ready === true;

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
  const isBundleLoading = false;

  return {
    activeTarget,
    activeThreadId,
    activeConversationAnchorId,
    agentResolution,
    agentRouteReady,
    bundle,
    bundleError: null,
    handleModelSelectionChange,
    initialModelSelection,
    isBundleLoading,
    messages,
    runtimeConversationSummaries,
    runtimeConversationSummariesReady,
    selectedThreadRecord,
    streamState,
    targetByLocalAgentRef,
    targets,
    targetsPending: false,
    targetsReady: true,
    textRouteModelProfile,
    threads,
    threadsReady: runtimeConversationSummariesReady,
  };
}
