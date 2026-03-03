import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { toWorldData, type WorldAgent } from './world-detail-model';
import { WorldDetailView } from './world-detail-view';

type WorldSemanticPayload = {
  world: Record<string, unknown> | null;
  worldview: Record<string, unknown> | null;
  worldviewEvents: Array<Record<string, unknown>>;
  worldviewSnapshots: Array<Record<string, unknown>>;
};

type AgentOption = {
  id: string;
  displayName: string;
  worldId: string | null;
};

type TransitMutationInput =
  | { type: 'start' }
  | { type: 'startSession' }
  | { type: 'complete' }
  | { type: 'abandon' }
  | { type: 'checkpoint'; name: string; status: 'PASSED' | 'FAILED' | 'SKIPPED' };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeAgentOption(raw: Record<string, unknown>): AgentOption | null {
  const id = asText(raw.id);
  if (!id) return null;
  const displayName = asText(raw.displayName) || asText(raw.handle) || asText(raw.name) || id;
  const worldId = asText(raw.worldId) || asText(raw.world_id) || null;
  return {
    id,
    displayName,
    worldId,
  };
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export function WorldDetailPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedWorldId = useAppStore((state) => state.selectedWorldId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [operationError, setOperationError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedWorldId) {
      return;
    }
    setRuntimeFields({
      worldId: selectedWorldId,
    });
  }, [selectedWorldId, setRuntimeFields]);

  const worldSemanticQuery = useQuery({
    queryKey: ['world-detail-semantic', selectedWorldId],
    queryFn: async (): Promise<WorldSemanticPayload | null> => {
      if (!selectedWorldId) return null;
      const result = await dataSync.loadWorldSemanticBundle(selectedWorldId);
      return result as WorldSemanticPayload;
    },
    enabled: authStatus === 'authenticated' && !!selectedWorldId,
  });

  const mainWorldQuery = useQuery({
    queryKey: ['world-main-world'],
    queryFn: async () => {
      const payload = await dataSync.loadMainWorld();
      return asRecord(payload);
    },
    enabled: authStatus === 'authenticated' && !!selectedWorldId,
  });

  const myAgentsQuery = useQuery({
    queryKey: ['world-transit-my-agents'],
    queryFn: async () => {
      const payload = await dataSync.loadMyAgents();
      return Array.isArray(payload) ? payload : [];
    },
    enabled: authStatus === 'authenticated' && !!selectedWorldId,
  });

  const agentOptions = useMemo(() => {
    const list = Array.isArray(myAgentsQuery.data) ? myAgentsQuery.data : [];
    return list
      .map((item) => normalizeAgentOption(asRecord(item) || {}))
      .filter((item): item is AgentOption => Boolean(item));
  }, [myAgentsQuery.data]);

  useEffect(() => {
    if (agentOptions.length <= 0) {
      setSelectedAgentId('');
      return;
    }
    if (!selectedAgentId || !agentOptions.some((item) => item.id === selectedAgentId)) {
      setSelectedAgentId(agentOptions[0]?.id || '');
    }
  }, [agentOptions, selectedAgentId]);

  const sceneQuotaQuery = useQuery({
    queryKey: ['world-scene-quota'],
    queryFn: async () => dataSync.loadSceneQuota(),
    enabled: authStatus === 'authenticated' && !!selectedWorldId,
  });

  const activeTransitQuery = useQuery({
    queryKey: ['world-active-transit', selectedAgentId],
    queryFn: async () => {
      if (!selectedAgentId) return null;
      return dataSync.getActiveWorldTransit(selectedAgentId);
    },
    enabled: authStatus === 'authenticated' && !!selectedWorldId && !!selectedAgentId,
  });

  const transitHistoryQuery = useQuery({
    queryKey: ['world-transit-history', selectedWorldId, selectedAgentId],
    queryFn: async () => {
      if (!selectedAgentId) return [];
      const transits = await dataSync.listWorldTransits({ agentId: selectedAgentId });
      return transits.filter((item) => (
        item.toWorldId === selectedWorldId || item.fromWorldId === selectedWorldId
      ));
    },
    enabled: authStatus === 'authenticated' && !!selectedWorldId && !!selectedAgentId,
  });

  const worldLevelAuditQuery = useQuery({
    queryKey: ['world-level-audits', selectedWorldId],
    queryFn: async () => {
      if (!selectedWorldId) return [];
      return dataSync.loadWorldLevelAudits(selectedWorldId, 10);
    },
    enabled: authStatus === 'authenticated' && !!selectedWorldId,
  });

  const worldAgentsQuery = useQuery({
    queryKey: ['world-agents', selectedWorldId],
    queryFn: async () => {
      if (!selectedWorldId) return [];
      const agents = await dataSync.loadWorldAgents(selectedWorldId);
      return agents.map((raw: Record<string, unknown>): WorldAgent => ({
        id: String(raw.id || ''),
        handle: String(raw.handle || ''),
        displayName: String(raw.displayName || raw.handle || 'Unknown'),
        avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
        bio: typeof raw.bio === 'string' ? raw.bio : null,
        worldId: String(raw.worldId || raw.world_id || ''),
        tier: typeof raw.tier === 'string' ? raw.tier : undefined,
        status: typeof raw.status === 'string' ? raw.status : undefined,
        isPublic: typeof raw.isPublic === 'boolean' ? raw.isPublic : undefined,
      }));
    },
    enabled: authStatus === 'authenticated' && !!selectedWorldId,
  });

  const world = useMemo(() => {
    const payload = worldSemanticQuery.data;
    if (!payload || !payload.world) return null;
    return toWorldData(payload.world, {
      worldview: payload.worldview,
      worldviewEvents: payload.worldviewEvents,
      worldviewSnapshots: payload.worldviewSnapshots,
    });
  }, [worldSemanticQuery.data]);

  const refreshTransitState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['world-scene-quota'] }),
      queryClient.invalidateQueries({ queryKey: ['world-active-transit', selectedAgentId] }),
      queryClient.invalidateQueries({ queryKey: ['world-transit-history', selectedWorldId, selectedAgentId] }),
      queryClient.invalidateQueries({ queryKey: ['world-level-audits', selectedWorldId] }),
    ]);
  };

  const transitMutation = useMutation({
    mutationFn: async (action: TransitMutationInput) => {
      if (!selectedWorldId) {
        throw new Error('WORLD_ID_REQUIRED');
      }
      if (!selectedAgentId) {
        throw new Error('WORLD_TRANSIT_AGENT_ID_REQUIRED');
      }
      const activeTransit = activeTransitQuery.data;
      if (action.type === 'start') {
        const fromWorldId = asText(mainWorldQuery.data?.id) || undefined;
        await dataSync.startWorldTransit({
          agentId: selectedAgentId,
          fromWorldId,
          toWorldId: selectedWorldId,
          transitType: 'INBOUND',
          reason: 'desktop-world-detail-enter',
        });
        return 'Transit started';
      }
      if (!activeTransit) {
        throw new Error('ACTIVE_TRANSIT_REQUIRED');
      }
      if (action.type === 'startSession') {
        await dataSync.startTransitSession(activeTransit.id);
        return 'Transit session started';
      }
      if (action.type === 'complete') {
        await dataSync.completeWorldTransit(activeTransit.id);
        return 'Transit completed';
      }
      if (action.type === 'abandon') {
        await dataSync.abandonWorldTransit(activeTransit.id);
        return 'Transit abandoned';
      }
      await dataSync.addTransitCheckpoint(activeTransit.id, {
        name: action.name,
        status: action.status,
      });
      return `Checkpoint added (${action.status})`;
    },
    onSuccess: async (message) => {
      setOperationError(null);
      setStatusBanner({ kind: 'success', message });
      await refreshTransitState();
    },
    onError: (error) => {
      const message = toErrorText(error);
      setOperationError(message);
      setStatusBanner({ kind: 'error', message });
    },
  });

  if (!selectedWorldId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        No world selected
      </div>
    );
  }

  if (!world && !worldSemanticQuery.isPending && !worldSemanticQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-500">World not found</p>
        <button
          type="button"
          onClick={navigateBack}
          className="rounded-[10px] bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <WorldDetailView
      world={world!}
      loading={worldSemanticQuery.isPending}
      error={worldSemanticQuery.isError}
      onBack={navigateBack}
      onRetry={() => { void worldSemanticQuery.refetch(); }}
      worldAgents={worldAgentsQuery.data || []}
      transitRuntime={{
        loading: Boolean(
          sceneQuotaQuery.isPending
          || activeTransitQuery.isPending
          || transitHistoryQuery.isPending
          || worldLevelAuditQuery.isPending
          || myAgentsQuery.isPending
          || worldAgentsQuery.isPending,
        ),
        mutating: transitMutation.isPending,
        selectedAgentId,
        agents: agentOptions,
        sceneQuota: sceneQuotaQuery.data || null,
        activeTransit: activeTransitQuery.data || null,
        history: transitHistoryQuery.data || [],
        audits: (worldLevelAuditQuery.data || []).map((item) => ({
          id: String(item.id || ''),
          eventType: String(item.eventType || ''),
          reasonCode: String(item.reasonCode || '') || null,
          occurredAt: String(item.occurredAt || ''),
        })),
        operationError,
        onSelectAgent: (agentId) => {
          setSelectedAgentId(agentId);
          setOperationError(null);
        },
        onStartTransit: () => transitMutation.mutate({ type: 'start' }),
        onStartSession: () => transitMutation.mutate({ type: 'startSession' }),
        onCompleteTransit: () => transitMutation.mutate({ type: 'complete' }),
        onAbandonTransit: () => transitMutation.mutate({ type: 'abandon' }),
        onAddCheckpoint: (input) => transitMutation.mutate({
          type: 'checkpoint',
          name: input.name,
          status: input.status,
        }),
        onRefresh: () => {
          setOperationError(null);
          void refreshTransitState();
        },
      }}
    />
  );
}
