/**
 * @deprecated Legacy detail view.
 * Active navigation now routes to features/world-detail/world-detail-view.tsx.
 */
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { XianxiaWorldTemplate, type XianxiaWorldData } from './world-xianxia-template';
import type { WorldListItem } from './world-list';
import type { WorldAgent } from './world-detail-template';
import {
  fetchWorldDetailWithAgents,
  fetchWorldEvents,
  worldDetailWithAgentsQueryKey,
  worldEventsQueryKey,
} from './world-detail-queries.js';

// Build XianxiaWorldData from list item + optional composite detail (with agents)
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
    type: ((detail?.type as string) ?? world.type) === 'MAIN' ? 'MAIN' : 'SUB',
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
    // Mock data — API 无对应字段，保留并标注 *
    subtitle: '山海暗涌，灵脉苏醒。一个凡人也能以心性、算计与机缘，穿越门派、秘境、乱星海与飞升之路。',
    quote: '凡人亦可问长生，天地无情，道途自争。',
    narrative: '这个 World 并不是一个静态的小说展厅，而是一个不断生长的修真生态。主世界以《凡人修仙传》的秩序感为底色：资源稀缺、机缘有限、修士谨慎、强者为尊、宗门与散修并存、秘境与拍卖场交替拉动剧情。\n\n在这里，用户并不只是旁观者，而是会影响世界变量的参与者。你可以让 Agent 扮演引路人、护法、执事、交易中介、秘境情报员、宗门长老或敌对势力代表；也可以让子世界承载特定地图、剧情线、宗门分舵、洞府系统、拍卖会系统和成长任务。\n\n整个首页模板强调"开放式"和"沉浸式"：世界信息清晰可读，评分总览一图展示，Agent 可随时进入聊天或语音，大事件沿时间轴推进，让用户一进入页面就有身处修真世界入口的感觉。',
  };
}

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
};

export function WorldDetail({ world, onBack }: WorldDetailProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const isReady = authStatus === 'authenticated' && !!world.id;

  // Combined API call: world detail + agent summaries in one request
  const worldCompositeQuery = useQuery({
    queryKey: worldDetailWithAgentsQueryKey(world.id),
    queryFn: () => fetchWorldDetailWithAgents(world.id),
    enabled: isReady,
  });

  // Independent API call for world events (Chronicle) — stays separate (different controller/auth)
  const worldEventsQuery = useQuery({
    queryKey: worldEventsQueryKey(world.id),
    queryFn: () => fetchWorldEvents(world.id),
    enabled: isReady,
  });

  const detail = worldCompositeQuery.data;
  const initialLoading = worldCompositeQuery.isPending && !detail;
  const initialError = worldCompositeQuery.isError && !detail;
  const worldData = toXianxiaWorldData(world, detail);

  // Map agent summaries from composite response (backend already flattened dna fields)
  const agentRecords = Array.isArray(detail?.agents) ? (detail.agents as Array<Record<string, unknown>>) : [];
  const agents: WorldAgent[] = agentRecords.map((a) => ({
    id: String(a.id || ''),
    name: String(a.name || 'Unknown'),
    handle: a.role ? `@${String(a.role)}` : (a.handle ? `@${String(a.handle)}` : `@${String(a.name || 'Unknown')}`),
    bio: String(a.bio || 'No description available.'),
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : world.createdAt,
    avatarUrl: a.avatarUrl ? String(a.avatarUrl) : undefined,
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

  return (
    <div className="h-full overflow-y-auto bg-[#f8fafb]">
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
      />
    </div>
  );
}
