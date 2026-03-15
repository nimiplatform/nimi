import { useMutation, useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { XianxiaWorldTemplate, type XianxiaWorldData } from './world-xianxia-template';
import type { WorldListItem } from './world-list-model';
import type { WorldAgent } from './world-detail-template';
import {
  fetchWorldDetailWithAgents,
  fetchWorldEvents,
  worldDetailWithAgentsQueryKey,
  worldEventsQueryKey,
} from './world-detail-queries';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toWorldComputed(raw: unknown, fallback: WorldListItem['computed']): WorldListItem['computed'] {
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
      isPaused: typeof time?.isPaused === 'boolean' ? time.isPaused : fallback.time.isPaused,
    },
    languages: {
      primary: readString(languages?.primary) ?? fallback.languages.primary,
      common: Array.isArray(languages?.common)
        ? languages.common.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : fallback.languages.common,
    },
    entry: {
      recommendedAgents: Array.isArray(entry?.recommendedAgents)
        ? entry.recommendedAgents.reduce<WorldListItem['computed']['entry']['recommendedAgents']>((acc, item) => {
          const agent = asRecord(item);
          if (!agent?.id) {
            return acc;
          }
          acc.push({
            id: String(agent.id),
            name: String(agent.name || 'Unknown'),
            handle: readString(agent.handle) ?? undefined,
            avatarUrl: readString(agent.avatarUrl) ?? undefined,
          });
          return acc;
        }, [])
        : fallback.entry.recommendedAgents,
    },
    score: {
      scoreEwma: readNumber(score?.scoreEwma) ?? fallback.score.scoreEwma,
    },
    featuredAgentCount: readNumber(record?.featuredAgentCount) ?? fallback.featuredAgentCount,
  };
}

function formatAgentHandle(agent: Record<string, unknown>, display: Record<string, unknown> | null, name: string): string {
  return readString(display?.role)
    ? `@${String(display?.role)}`
    : (readString(agent.handle) ? `@${String(agent.handle)}` : `@${name}`);
}

function toWorldAgent(agent: Record<string, unknown>, worldCreatedAt: string): WorldAgent {
  const display = asRecord(agent.display);
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
  };
}

function orderAgentsByRecommendation(agentRecords: Array<Record<string, unknown>>, recommendedIds: string[]): Array<Record<string, unknown>> {
  if (recommendedIds.length === 0) {
    return agentRecords;
  }
  const byId = new Map(agentRecords.map((agent) => [String(agent.id || ''), agent]));
  const ordered: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const id of recommendedIds) {
    const agent = byId.get(id);
    if (agent && !seen.has(id)) {
      ordered.push(agent);
      seen.add(id);
    }
  }

  for (const agent of agentRecords) {
    const id = String(agent.id || '');
    if (!seen.has(id)) {
      ordered.push(agent);
    }
  }

  return ordered;
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
    transitInLimit: (detail?.transitInLimit as number) ?? world.transitInLimit,
    genre: (detail?.genre as string | null) ?? world.genre,
    era: (detail?.era as string | null) ?? world.era,
    themes: (detail?.themes as string[] | null) ?? world.themes,
  };
}

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
};

export function WorldDetail({ world, onBack }: WorldDetailProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const isReady = authStatus === 'authenticated' && !!world.id;

  const worldCompositeQuery = useQuery({
    queryKey: worldDetailWithAgentsQueryKey(world.id),
    queryFn: () => fetchWorldDetailWithAgents(world.id),
    enabled: isReady,
  });

  const worldEventsQuery = useQuery({
    queryKey: worldEventsQueryKey(world.id),
    queryFn: () => fetchWorldEvents(world.id),
    enabled: isReady,
  });

  const detail = worldCompositeQuery.data;
  const initialLoading = worldCompositeQuery.isPending && !detail;
  const initialError = worldCompositeQuery.isError && !detail;
  const worldData = toXianxiaWorldData(world, detail);

  const agentRecords = Array.isArray(detail?.agents) ? (detail.agents as Array<Record<string, unknown>>) : [];
  const detailComputed = toWorldComputed(detail?.computed, world.computed);
  const recommendedIds = detailComputed.entry.recommendedAgents.map((agent) => agent.id);
  const agents: WorldAgent[] = orderAgentsByRecommendation(agentRecords, recommendedIds)
    .map((agent) => toWorldAgent(agent, world.createdAt));

  const events = worldEventsQuery.data || [];

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
      wakeStrategy: '' | 'PASSIVE' | 'PROACTIVE';
      dnaPrimary: '' | 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
      dnaSecondary: string[];
    }) =>
      dataSync.createAgent({
        worldId: world.id,
        handle: input.handle,
        concept: input.concept,
        displayName: input.displayName || undefined,
        description: input.description || undefined,
        scenario: input.scenario || undefined,
        greeting: input.greeting || undefined,
        referenceImageUrl: input.referenceImageUrl || undefined,
        wakeStrategy: input.wakeStrategy || undefined,
        dnaPrimary: (input.dnaPrimary || undefined) as Parameters<typeof dataSync.createAgent>[0]['dnaPrimary'],
        dnaSecondary: input.dnaSecondary.length
          ? input.dnaSecondary as Parameters<typeof dataSync.createAgent>[0]['dnaSecondary']
          : undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: worldDetailWithAgentsQueryKey(world.id) });
    },
  });

  return (
    <ScrollShell className="h-full bg-[#f8fafb]" viewportClassName="bg-[#f8fafb]">
      <XianxiaWorldTemplate
        world={worldData}
        agents={agents}
        events={events}
        loading={initialLoading}
        error={initialError}
        agentsLoading={worldCompositeQuery.isPending}
        eventsLoading={worldEventsQuery.isPending}
        onBack={onBack}
        onEnterEdit={handleEnterEdit}
        onCreateSubWorld={handleCreateSubWorld}
        onChatAgent={handleChatAgent}
        onVoiceAgent={handleVoiceAgent}
        onCreateAgent={(input) => createAgentMutation.mutate(input)}
        createAgentMutating={createAgentMutation.isPending}
      />
    </ScrollShell>
  );
}
