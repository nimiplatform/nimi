import { useMutation, useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { XianxiaWorldTemplate, type XianxiaWorldData } from './world-xianxia-template';
import type { WorldListItem } from './world-list';
import type { WorldAgent } from './world-detail-template';
import {
  fetchWorldDetailWithAgents,
  fetchWorldEvents,
  worldDetailWithAgentsQueryKey,
  worldEventsQueryKey,
} from './world-detail-queries';

function toXianxiaWorldData(
  world: WorldListItem,
  detail?: Record<string, unknown> | null,
): XianxiaWorldData {
  return {
    id: world.id,
    name: (detail?.name as string) ?? world.name,
    description: (detail?.description as string | null) ?? world.description,
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
    timeFlowRatio: (detail?.timeFlowRatio as number) ?? world.timeFlowRatio,
    transitInLimit: (detail?.transitInLimit as number) ?? world.transitInLimit,
    genre: (detail?.genre as string | null) ?? world.genre,
    era: (detail?.era as string | null) ?? world.era,
    themes: (detail?.themes as string[] | null) ?? world.themes,
    clockConfig: (detail?.clockConfig as Record<string, unknown> | null) ?? null,
    sceneTimeConfig: (detail?.sceneTimeConfig as Record<string, unknown> | null) ?? null,
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
  const agents: WorldAgent[] = agentRecords.map((agent) => ({
    id: String(agent.id || ''),
    name: String(agent.name || 'Unknown'),
    handle: agent.role
      ? `@${String(agent.role)}`
      : (agent.handle ? `@${String(agent.handle)}` : `@${String(agent.name || 'Unknown')}`),
    bio: String(agent.bio || 'No description available.'),
    createdAt: typeof agent.createdAt === 'string' ? agent.createdAt : world.createdAt,
    avatarUrl: agent.avatarUrl ? String(agent.avatarUrl) : undefined,
  }));

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
