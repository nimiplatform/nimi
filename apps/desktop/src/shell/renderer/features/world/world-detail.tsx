import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  NarrativeWorldDetailPage,
  OasisWorldDetailPage,
  type XianxiaWorldData,
} from './world-detail-template';
import type {
  WorldAgent,
  WorldHistoryBundle,
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldSemanticData,
} from './world-detail-types';
import type { WorldListItem } from './world-list-model';
import {
  fetchWorldDetailWithAgents,
  fetchWorldHistory,
  fetchWorldLevelAudits,
  fetchWorldPublicAssets,
  fetchWorldSemanticBundle,
  worldDetailWithAgentsQueryKey,
  worldHistoryQueryKey,
  worldLevelAuditsQueryKey,
  worldPublicAssetsQueryKey,
  worldSemanticBundleQueryKey,
} from './world-detail-queries';

type DetailComputed = {
  time: {
    currentWorldTime: string | null;
    currentLabel: string | null;
    eraLabel: string | null;
    flowRatio: number;
    isPaused: boolean;
  };
  languages: {
    primary: string | null;
    common: string[];
  };
  entry: {
    recommendedAgents: WorldRecommendedAgent[];
  };
  score: {
    scoreEwma: number;
  };
  featuredAgentCount: number;
};

const EMPTY_WORLD_HISTORY: WorldHistoryBundle = {
  items: [],
  summary: null,
};

const EMPTY_WORLD_SEMANTIC: WorldSemanticData = {
  operationTitle: null,
  operationDescription: null,
  operationRules: [],
  powerSystems: [],
  standaloneLevels: [],
  taboos: [],
  topology: null,
  causality: null,
  languages: [],
  worldviewEvents: [],
  worldviewSnapshots: [],
  hasContent: false,
};

const EMPTY_WORLD_PUBLIC_ASSETS: WorldPublicAssetsData = {
  lorebooks: [],
  scenes: [],
  resourceBindings: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function toWorldComputed(raw: unknown, fallback: WorldListItem['computed']): DetailComputed {
  const record = asRecord(raw);
  const time = asRecord(record?.time);
  const languages = asRecord(record?.languages);
  const entry = asRecord(record?.entry);
  const score = asRecord(record?.score);

  return {
    time: {
      currentWorldTime: readString(time?.currentWorldTime) ?? fallback.time.currentWorldTime,
      currentLabel: readString(time?.currentLabel) ?? fallback.time.currentLabel,
      eraLabel: readString(time?.eraLabel) ?? fallback.time.eraLabel,
      flowRatio: Math.max(0.0001, readNumber(time?.flowRatio) ?? fallback.time.flowRatio),
      isPaused: readBoolean(time?.isPaused) ?? fallback.time.isPaused,
    },
    languages: {
      primary: readString(languages?.primary) ?? fallback.languages.primary,
      common: Array.isArray(languages?.common)
        ? languages.common.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : fallback.languages.common,
    },
    entry: {
      recommendedAgents: Array.isArray(entry?.recommendedAgents)
        ? entry.recommendedAgents.reduce<WorldRecommendedAgent[]>((acc, item) => {
          const agent = asRecord(item);
          if (!agent?.id) {
            return acc;
          }
          const display = asRecord(agent.display);
          acc.push({
            id: String(agent.id),
            name: String(agent.name || 'Unknown'),
            handle: readString(agent.handle),
            avatarUrl: readString(agent.avatarUrl),
            importance: agent.importance === 'PRIMARY' || agent.importance === 'BACKGROUND' ? agent.importance : 'SECONDARY',
            display: display
              ? {
                  role: readString(display.role),
                  faction: readString(display.faction),
                  rank: readString(display.rank),
                  sceneName: readString(display.sceneName),
                  location: readString(display.location),
                }
              : null,
          });
          return acc;
        }, [])
        : [],
    },
    score: {
      scoreEwma: readNumber(score?.scoreEwma) ?? fallback.score.scoreEwma,
    },
    featuredAgentCount: readNumber(record?.featuredAgentCount) ?? fallback.featuredAgentCount,
  };
}

function formatAgentHandle(agent: Record<string, unknown>, display: Record<string, unknown> | null, name: string): string {
  return readString(agent.handle)
    ? `@${String(agent.handle)}`
    : (readString(display?.role) ? `@${String(display?.role)}` : `@${name}`);
}

function toWorldAgent(agent: Record<string, unknown>, worldCreatedAt: string): WorldAgent {
  const display = asRecord(agent.display);
  const stats = asRecord(agent.stats);
  const name = String(agent.name || 'Unknown');

  return {
    id: String(agent.id || ''),
    name,
    handle: formatAgentHandle(agent, display, name),
    bio: String(agent.bio || 'No description available.'),
    role: readString(display?.role),
    faction: readString(display?.faction),
    rank: readString(display?.rank),
    sceneName: readString(display?.sceneName),
    location: readString(display?.location),
    createdAt: typeof agent.createdAt === 'string' ? agent.createdAt : worldCreatedAt,
    avatarUrl: agent.avatarUrl ? String(agent.avatarUrl) : undefined,
    importance: agent.importance === 'PRIMARY' || agent.importance === 'BACKGROUND' ? agent.importance : 'SECONDARY',
    stats: stats
      ? {
          vitalityScore: readNumber(stats.vitalityScore),
          influenceTier: readString(stats.influenceTier),
          interactionTier: readString(stats.interactionTier),
          engagementCount: readNumber(stats.engagementCount),
          lastActiveAt: readString(stats.lastActiveAt),
        }
      : null,
  };
}

function toXianxiaWorldData(
  world: WorldListItem,
  detail?: Record<string, unknown> | null,
): XianxiaWorldData {
  const computed = toWorldComputed(detail?.computed, world.computed);
  return {
    id: world.id,
    name: (detail?.name as string) ?? world.name,
    description: (detail?.description as string | null) ?? world.description,
    tagline: (detail?.tagline as string | null) ?? world.tagline ?? null,
    motto: (detail?.motto as string | null) ?? world.motto ?? null,
    overview: (detail?.overview as string | null) ?? world.overview ?? null,
    contentRating: (detail?.contentRating as string | null) ?? world.contentRating ?? null,
    iconUrl: (detail?.iconUrl as string | null) ?? world.iconUrl,
    bannerUrl: (detail?.bannerUrl as string | null) ?? world.bannerUrl,
    type: ((detail?.type as string) ?? world.type) === 'OASIS' ? 'OASIS' : 'CREATOR',
    status: ((detail?.status as string) ?? world.status) as XianxiaWorldData['status'],
    level: (detail?.level as number) ?? world.level,
    levelUpdatedAt: (detail?.levelUpdatedAt as string | null) ?? world.levelUpdatedAt,
    agentCount: (detail?.agentCount as number) ?? world.agentCount,
    createdAt: (detail?.createdAt as string) ?? world.createdAt,
    creatorId: (detail?.creatorId as string | null) ?? world.creatorId,
    freezeReason: ((detail?.freezeReason as string | null) ?? world.freezeReason) as XianxiaWorldData['freezeReason'],
    lorebookEntryLimit: (detail?.lorebookEntryLimit as number) ?? world.lorebookEntryLimit,
    nativeAgentLimit: (detail?.nativeAgentLimit as number) ?? world.nativeAgentLimit,
    nativeCreationState: ((detail?.nativeCreationState as string) ?? world.nativeCreationState) as XianxiaWorldData['nativeCreationState'],
    scoreA: (detail?.scoreA as number) ?? world.scoreA,
    scoreC: (detail?.scoreC as number) ?? world.scoreC,
    scoreE: (detail?.scoreE as number) ?? world.scoreE,
    scoreEwma: (detail?.scoreEwma as number) ?? world.scoreEwma,
    scoreQ: (detail?.scoreQ as number) ?? world.scoreQ,
    flowRatio: computed.time.flowRatio,
    isPaused: computed.time.isPaused,
    transitInLimit: (detail?.transitInLimit as number) ?? world.transitInLimit,
    genre: (detail?.genre as string | null) ?? world.genre,
    era: (detail?.era as string | null) ?? world.era,
    themes: (detail?.themes as string[] | null) ?? world.themes,
    currentWorldTime: computed.time.currentWorldTime,
    currentTimeLabel: computed.time.currentLabel,
    eraLabel: computed.time.eraLabel,
    primaryLanguage: computed.languages.primary,
    commonLanguages: computed.languages.common,
    recommendedAgents: computed.entry.recommendedAgents,
  };
}

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
};

export function WorldDetail({ world, onBack }: WorldDetailProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const isReady = authStatus === 'authenticated' && !!world.id;
  const flowIdRef = useRef('');
  const enteredAtRef = useRef(0);
  const primaryReadyLoggedRef = useRef(false);
  const historySemanticReadyLoggedRef = useRef(false);
  const extendedReadyLoggedRef = useRef(false);

  const worldCompositeQuery = useQuery({
    queryKey: worldDetailWithAgentsQueryKey(world.id),
    queryFn: () => fetchWorldDetailWithAgents(world.id),
    enabled: isReady,
    staleTime: 30_000,
  });

  const worldHistoryQuery = useQuery({
    queryKey: worldHistoryQueryKey(world.id),
    queryFn: () => fetchWorldHistory(world.id),
    enabled: isReady,
    staleTime: 30_000,
  });

  const worldSemanticQuery = useQuery({
    queryKey: worldSemanticBundleQueryKey(world.id),
    queryFn: () => fetchWorldSemanticBundle(world.id),
    enabled: isReady,
    staleTime: 30_000,
  });

  const worldAuditQuery = useQuery({
    queryKey: worldLevelAuditsQueryKey(world.id),
    queryFn: () => fetchWorldLevelAudits(world.id),
    enabled: isReady && worldCompositeQuery.isSuccess,
  });

  const worldPublicAssetsQuery = useQuery({
    queryKey: worldPublicAssetsQueryKey(world.id),
    queryFn: () => fetchWorldPublicAssets(world.id),
    enabled: isReady && worldCompositeQuery.isSuccess,
  });

  const detail = worldCompositeQuery.data;
  const initialLoading = worldCompositeQuery.isPending && !detail;
  const initialError = !initialLoading
    && (worldCompositeQuery.isError || (worldCompositeQuery.isSuccess && !detail));
  const worldData = toXianxiaWorldData(world, detail);

  const agentRecords = Array.isArray(detail?.agents) ? (detail.agents as Array<Record<string, unknown>>) : [];
  const agents: WorldAgent[] = agentRecords.map((agent) => toWorldAgent(agent, world.createdAt));

  const safeHistory = worldHistoryQuery.data ?? EMPTY_WORLD_HISTORY;
  const safeSemantic = worldSemanticQuery.data ?? EMPTY_WORLD_SEMANTIC;
  const safeAudits = worldAuditQuery.data ?? [];
  const safePublicAssets = worldPublicAssetsQuery.data ?? EMPTY_WORLD_PUBLIC_ASSETS;

  useEffect(() => {
    if (!isReady) {
      return;
    }
    flowIdRef.current = createRendererFlowId('world-detail');
    enteredAtRef.current = performance.now();
    primaryReadyLoggedRef.current = false;
    historySemanticReadyLoggedRef.current = false;
    extendedReadyLoggedRef.current = false;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:entered',
      flowId: flowIdRef.current,
      details: {
        worldId: world.id,
        stage: 'entered',
      },
    });
  }, [isReady, world.id]);

  useEffect(() => {
    if (!worldCompositeQuery.isSuccess || !detail || primaryReadyLoggedRef.current) {
      return;
    }
    primaryReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:primary-ready',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'primary',
      },
    });
  }, [detail, world.id, worldCompositeQuery.isSuccess]);

  useEffect(() => {
    const historySettled = worldHistoryQuery.isSuccess || worldHistoryQuery.isError;
    const semanticSettled = worldSemanticQuery.isSuccess || worldSemanticQuery.isError;
    if (!detail || !historySettled || !semanticSettled || historySemanticReadyLoggedRef.current) {
      return;
    }
    historySemanticReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:history-semantic-settled',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'secondary',
        historyStatus: worldHistoryQuery.isSuccess ? 'success' : 'error',
        semanticStatus: worldSemanticQuery.isSuccess ? 'success' : 'error',
      },
    });
  }, [
    detail,
    world.id,
    worldHistoryQuery.isError,
    worldHistoryQuery.isSuccess,
    worldSemanticQuery.isError,
    worldSemanticQuery.isSuccess,
  ]);

  useEffect(() => {
    const auditSettled = worldAuditQuery.isSuccess || worldAuditQuery.isError;
    const publicAssetsSettled = worldPublicAssetsQuery.isSuccess || worldPublicAssetsQuery.isError;
    if (!detail || !auditSettled || !publicAssetsSettled || extendedReadyLoggedRef.current) {
      return;
    }
    extendedReadyLoggedRef.current = true;
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'detail:assets-audits-settled',
      flowId: flowIdRef.current,
      costMs: Number((performance.now() - enteredAtRef.current).toFixed(2)),
      details: {
        worldId: world.id,
        stage: 'non-critical',
        auditStatus: worldAuditQuery.isSuccess ? 'success' : 'error',
        publicAssetsStatus: worldPublicAssetsQuery.isSuccess ? 'success' : 'error',
      },
    });
  }, [
    detail,
    world.id,
    worldAuditQuery.isError,
    worldAuditQuery.isSuccess,
    worldPublicAssetsQuery.isError,
    worldPublicAssetsQuery.isSuccess,
  ]);

  const handleChatAgent = (agent: WorldAgent) => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:chat-agent:clicked',
      details: {
        worldId: world.id,
        agentId: agent.id,
      },
    });
  };

  const handleVoiceAgent = (agent: WorldAgent) => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:voice-agent:clicked',
      details: {
        worldId: world.id,
        agentId: agent.id,
      },
    });
  };

  const handleViewAgent = (agent: WorldAgent) => {
    navigateToProfile(agent.id, 'agent-detail');
  };

  const handleEnterEdit = () => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:enter-edit:clicked',
      details: {
        worldId: world.id,
      },
    });
  };

  const handleCreateSubWorld = () => {
    logRendererEvent({
      level: 'info',
      area: 'world-detail',
      message: 'action:create-sub-world:clicked',
      details: {
        worldId: world.id,
      },
    });
  };

  const createAgentMutation = useMutation({
    mutationFn: async (input: {
      handle: string;
      displayName: string;
      concept: string;
      description: string;
      scenario: string;
      greeting: string;
      referenceImageUrl: string;
      referenceImageFile: File | null;
      wakeStrategy: '' | 'PASSIVE' | 'PROACTIVE';
      dnaPrimary: '' | 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
      dnaSecondary: string[];
    }) => {
      let resolvedImageUrl: string | undefined;
      if (input.referenceImageFile) {
        const upload = await dataSync.createImageDirectUpload();
        const formData = new FormData();
        formData.append('file', input.referenceImageFile);
        const response = await fetch(upload.uploadUrl, { method: 'POST', body: formData });
        if (!response.ok) {
          throw new Error('头像上传失败，请重试');
        }
        const finalized = await dataSync.finalizeResource(upload.resourceId, {});
        resolvedImageUrl = finalized.url ?? undefined;
      }
      return dataSync.createAgent({
        worldId: world.id,
        handle: input.handle,
        concept: input.concept,
        displayName: input.displayName || undefined,
        description: input.description || undefined,
        scenario: input.scenario || undefined,
        greeting: input.greeting || undefined,
        referenceImageUrl: resolvedImageUrl,
        wakeStrategy: input.wakeStrategy || undefined,
        dnaPrimary: (input.dnaPrimary || undefined) as Parameters<typeof dataSync.createAgent>[0]['dnaPrimary'],
        dnaSecondary: input.dnaSecondary.length
          ? input.dnaSecondary as Parameters<typeof dataSync.createAgent>[0]['dnaSecondary']
          : undefined,
      });
    },
    onSuccess: async (data) => {
      const agentId = typeof data?.id === 'string' && data.id ? data.id : null;
      await queryClient.invalidateQueries({ queryKey: worldDetailWithAgentsQueryKey(world.id) });
      if (agentId) {
        navigateToProfile(agentId, 'agent-detail');
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : '创建 Agent 失败，请重试';
      setStatusBanner({ kind: 'error', message });
    },
  });

  return (
    <ScrollShell className="h-full bg-[#f8fafb]" viewportClassName="bg-[#f8fafb]">
      {worldData.type === 'OASIS' ? (
        <OasisWorldDetailPage
          world={worldData}
          agents={agents}
          history={safeHistory}
          semantic={safeSemantic}
          audits={safeAudits}
          publicAssets={safePublicAssets}
          loading={initialLoading}
          error={initialError}
          agentsLoading={worldCompositeQuery.isPending}
          historyLoading={worldHistoryQuery.isPending}
          semanticLoading={worldSemanticQuery.isPending}
          auditsLoading={worldAuditQuery.isPending}
          publicAssetsLoading={worldPublicAssetsQuery.isPending}
          onBack={onBack}
          onEnterEdit={handleEnterEdit}
          onCreateSubWorld={handleCreateSubWorld}
          onChatAgent={handleChatAgent}
          onVoiceAgent={handleVoiceAgent}
          onViewAgent={handleViewAgent}
          onCreateAgent={(input) => createAgentMutation.mutate(input)}
          createAgentMutating={createAgentMutation.isPending}
        />
      ) : (
        <NarrativeWorldDetailPage
          world={worldData}
          agents={agents}
          history={safeHistory}
          semantic={safeSemantic}
          audits={safeAudits}
          publicAssets={safePublicAssets}
          loading={initialLoading}
          error={initialError}
          agentsLoading={worldCompositeQuery.isPending}
          historyLoading={worldHistoryQuery.isPending}
          semanticLoading={worldSemanticQuery.isPending}
          auditsLoading={worldAuditQuery.isPending}
          publicAssetsLoading={worldPublicAssetsQuery.isPending}
          onBack={onBack}
          onEnterEdit={handleEnterEdit}
          onCreateSubWorld={handleCreateSubWorld}
          onChatAgent={handleChatAgent}
          onVoiceAgent={handleVoiceAgent}
          onViewAgent={handleViewAgent}
          onCreateAgent={(input) => createAgentMutation.mutate(input)}
          createAgentMutating={createAgentMutation.isPending}
        />
      )}
    </ScrollArea>
  );
}
