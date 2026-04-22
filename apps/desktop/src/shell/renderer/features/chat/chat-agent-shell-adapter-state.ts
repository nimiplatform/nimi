import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import {
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
  toConversationMessageViewModel,
} from './chat-agent-thread-model';
import { findRuntimeRouteModelProfile } from './chat-ai-route-view';
import type { AgentConversationSelection } from './chat-shell-types';
import { useAgentVisibleProjection } from './chat-agent-visible-projection-store';
import { useConversationStreamState } from './chat-runtime-stream-ui';
import { getAgentConversationAnchorBinding } from './chat-agent-anchor-binding-storage';
import {
  bundleQueryKey,
  isEmptyPendingAssistantMessage,
  sortThreadSummaries,
  TARGETS_QUERY_KEY,
  THREADS_QUERY_KEY,
} from './chat-agent-shell-core';
import {
  toRuntimeRouteBindingFromPickerSelection,
  type AIConfig,
} from './conversation-capability';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { loadDesktopRouteOptions } from '../runtime-config/desktop-route-options-service';

type SocialSnapshot = Awaited<ReturnType<typeof dataSync.loadSocialSnapshot>>;

type UseAgentConversationShellStateInput = {
  aiConfig: AIConfig;
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  bootstrapReady: boolean;
  lastSelectedThreadId: string | null;
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
  selectedThreadRecord: AgentLocalThreadSummary | null;
  streamState: ReturnType<typeof useConversationStreamState>;
  targetByAgentId: Map<string, AgentLocalTargetSnapshot>;
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
    const binding = toRuntimeRouteBindingFromPickerSelection({
      capability: 'text.generate',
      selection,
    });
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
      return toAgentFriendTargetsFromSocialSnapshot(snapshot);
    },
    enabled: input.authStatus === 'authenticated',
  });
  const targets = useMemo(
    () => targetsQuery.data || [],
    [targetsQuery.data],
  );
  const targetByAgentId = useMemo(
    () => new Map(targets.map((target) => [target.agentId, target])),
    [targets],
  );

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAgentStoreClient.listThreads(),
    enabled: input.authStatus === 'authenticated',
  });
  const threads = useMemo(
    () => sortThreadSummaries(threadsQuery.data || []),
    [threadsQuery.data],
  );
  const activeThreadId = useMemo(
    () => resolveAgentConversationActiveThreadId({
      threads,
      selectionThreadId: input.selection.threadId,
      selectionAgentId: input.selection.agentId,
      lastSelectedThreadId: input.lastSelectedThreadId,
    }),
    [input.lastSelectedThreadId, input.selection.agentId, input.selection.threadId, threads],
  );
  const selectedThreadRecord = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads],
  );
  const activeConversationAnchorId = useMemo(
    () => getAgentConversationAnchorBinding(selectedThreadRecord?.id || null)?.conversationAnchorId || null,
    [selectedThreadRecord?.id],
  );
  const selectedTarget = useMemo(
    () => targetByAgentId.get(input.selection.agentId || '') || null,
    [input.selection.agentId, targetByAgentId],
  );
  const activeTarget = selectedThreadRecord?.targetSnapshot || selectedTarget || null;
  const agentRouteReady = agentResolution?.ready === true;

  const bundleQuery = useQuery({
    queryKey: activeThreadId ? bundleQueryKey(activeThreadId) : ['chat-agent-thread-bundle', 'inactive'],
    queryFn: () => chatAgentStoreClient.getThreadBundle(activeThreadId as string),
    enabled: Boolean(activeThreadId),
    staleTime: 60_000,
  });
  const bundle = bundleQuery.data || null;
  const projectedBundle = useAgentVisibleProjection(activeThreadId);
  const visibleMessages = projectedBundle?.messages || bundle?.messages || [];
  const messages = useMemo(
    () => visibleMessages
      .map((message: AgentLocalMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [visibleMessages],
  );
  const streamState = useConversationStreamState(activeThreadId);
  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;

  return {
    activeTarget,
    activeThreadId,
    activeConversationAnchorId,
    agentResolution,
    agentRouteReady,
    bundle,
    bundleError: bundleQuery.error,
    handleModelSelectionChange,
    initialModelSelection,
    isBundleLoading,
    messages,
    selectedThreadRecord,
    streamState,
    targetByAgentId,
    targets,
    targetsPending: targetsQuery.isPending,
    targetsReady: targetsQuery.isSuccess,
    textRouteModelProfile,
    threads,
    threadsReady: threadsQuery.isSuccess,
  };
}
