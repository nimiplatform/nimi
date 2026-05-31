import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RouteModelPickerSelection } from '@nimiplatform/kit/features/model-picker';
import { pickerSelectionToBinding } from '@nimiplatform/kit/features/model-config/headless';
import {
  findRuntimeRouteModelProfile,
  type RuntimeRouteBinding,
} from '@nimiplatform/sdk/ai';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import {
  overlayAgentTargetWithLiveProfileContent,
  toAgentFriendTargetsFromSocialSnapshot,
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
  TARGETS_QUERY_KEY,
} from './chat-agent-shell-core';
import {
  listRuntimeAgentConversationSummaries,
  RUNTIME_AGENT_CONVERSATION_SUMMARIES_QUERY_KEY,
  type AgentRuntimeConversationSummary,
} from './chat-agent-runtime-conversation-summaries';
import {
  type AIConfig,
} from './conversation-capability';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { loadDesktopRouteOptions } from '../runtime-config/desktop-route-options-service';

type SocialSnapshot = Awaited<ReturnType<typeof dataSync.loadSocialSnapshot>>;

function synthesizeAgentThreadSummaryFromRuntimeSummary(
  summary: AgentRuntimeConversationSummary,
): AgentLocalThreadSummary {
  return {
    id: createAgentConversationCacheThreadId(summary.localAgentRef),
    ownerUserId: summary.ownerUserId,
    realmAgentId: summary.realmAgentId,
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
    realmAgentId: target.realmAgentId,
    localAgentRef: target.localAgentRef,
    title: target.displayName,
    updatedAtMs: 0,
    lastMessageAtMs: null,
    targetSnapshot: target,
  };
}

type UseAgentConversationShellStateInput = {
  aiConfig: AIConfig;
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
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
  textRouteModelProfile: ReturnType<typeof findRuntimeRouteModelProfile>;
  threads: AgentLocalThreadSummary[];
  threadsReady: boolean;
};

export function useAgentConversationShellState(
  input: UseAgentConversationShellStateInput,
): AgentConversationShellState {
  const agentResolution = useAppStore((state) => state.agentEffectiveCapabilityResolution);
  const textGenerateBinding = input.aiConfig.capabilities.selectedBindings['text.generate'] as
    | RuntimeRouteBinding
    | null
    | undefined;
  const hasExplicitTextGenerateSelection = Object.prototype.hasOwnProperty.call(
    input.aiConfig.capabilities.selectedBindings,
    'text.generate',
  );
  const selectedTextBinding = hasExplicitTextGenerateSelection
    ? (textGenerateBinding ?? null)
    : null;
  const textRouteOptionsQuery = useQuery({
    queryKey: ['chat-agent-route-options', 'text.generate'],
    queryFn: () => loadDesktopRouteOptions('text.generate'),
    enabled: input.bootstrapReady,
    staleTime: 60_000,
  });
  const textRouteModelProfile = useMemo(
    () => findRuntimeRouteModelProfile(textRouteOptionsQuery.data, selectedTextBinding),
    [selectedTextBinding, textRouteOptionsQuery.data],
  );

  const handleModelSelectionChange = useCallback((selection: RouteModelPickerSelection) => {
    if (!selection.model) {
      return;
    }
    const currentModel = selectedTextBinding?.modelId || selectedTextBinding?.model || '';
    if (
      selectedTextBinding
      && selectedTextBinding.source === selection.source
      && currentModel === selection.model
    ) {
      return;
    }
    const binding = pickerSelectionToBinding(selection);
    if (!binding) {
      return;
    }
    const surface = getDesktopAIConfigService();
    const nextBindings = { ...input.aiConfig.capabilities.selectedBindings };
    nextBindings['text.generate'] = binding;
    const nextConfig = {
      ...input.aiConfig,
      capabilities: { ...input.aiConfig.capabilities, selectedBindings: nextBindings },
    };
    surface.aiConfig.update(nextConfig.scopeRef, nextConfig);
  }, [input.aiConfig, selectedTextBinding]);

  const initialModelSelection = useMemo<Partial<RouteModelPickerSelection>>(() => {
    if (!selectedTextBinding) {
      return {};
    }
    return {
      source: selectedTextBinding.source,
      connectorId: selectedTextBinding.connectorId || '',
      model: selectedTextBinding.modelId || selectedTextBinding.model || '',
      modelLabel: selectedTextBinding.modelLabel,
    };
  }, [selectedTextBinding]);

  const targetsQuery = useQuery({
    queryKey: [...TARGETS_QUERY_KEY, input.authStatus],
    queryFn: async (): Promise<AgentLocalTargetSnapshot[]> => {
      const snapshot = await dataSync.loadSocialSnapshot() as SocialSnapshot;
      const ownerUserId = String((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id || '').trim();
      return toAgentFriendTargetsFromSocialSnapshot({ ...((snapshot as Record<string, unknown> | null) || {}), ownerUserId });
    },
    enabled: input.authStatus === 'authenticated',
  });
  const targets = useMemo(
    () => targetsQuery.data || [],
    [targetsQuery.data],
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
    enabled: input.authStatus === 'authenticated' && targetsQuery.isSuccess && targets.length > 0,
    staleTime: 60_000,
  });
  const runtimeConversationSummaries = useMemo(
    () => (targets.length === 0 ? [] : runtimeConversationSummariesQuery.data || []),
    [runtimeConversationSummariesQuery.data, targets.length],
  );
  const runtimeConversationSummariesReady = targets.length === 0
    ? targetsQuery.isSuccess
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
  const activeConversationAnchorId = useMemo(
    () => getAgentConversationAnchorBinding(activeAnchorBindingLocalAgentRef)?.conversationAnchorId || null,
    [activeAnchorBindingLocalAgentRef, anchorBindingVersion],
  );
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
    targetsPending: targetsQuery.isPending,
    targetsReady: targetsQuery.isSuccess,
    textRouteModelProfile,
    threads,
    threadsReady: runtimeConversationSummariesReady,
  };
}
