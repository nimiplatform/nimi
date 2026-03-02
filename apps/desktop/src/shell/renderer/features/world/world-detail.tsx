import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { XianxiaWorldTemplate, type XianxiaWorldData } from './world-xianxia-template';
import type { WorldListItem } from './world-list';
import type { WorldAgent, WorldEvent } from './world-detail-template';
import type { WorldDetailDto } from '@nimiplatform/sdk/realm';

// Build XianxiaWorldData from list item + optional full detail
function toXianxiaWorldData(
  world: WorldListItem,
  detail?: WorldDetailDto | null,
): XianxiaWorldData {
  return {
    id: world.id,
    name: detail?.name ?? world.name,
    description: detail?.description ?? world.description,
    iconUrl: detail?.iconUrl ?? world.iconUrl,
    bannerUrl: detail?.bannerUrl ?? world.bannerUrl,
    type: (detail?.type ?? world.type) === 'MAIN' ? 'MAIN' : 'SUB',
    status: (detail?.status ?? world.status) as XianxiaWorldData['status'],
    level: detail?.level ?? world.level,
    levelUpdatedAt: (detail?.levelUpdatedAt as string | null) ?? world.levelUpdatedAt,
    agentCount: detail?.agentCount ?? world.agentCount,
    createdAt: (detail?.createdAt as string) ?? world.createdAt,
    creatorId: detail?.creatorId ?? world.creatorId,
    freezeReason: (detail?.freezeReason ?? world.freezeReason) as XianxiaWorldData['freezeReason'],
    lorebookEntryLimit: detail?.lorebookEntryLimit ?? world.lorebookEntryLimit,
    nativeAgentLimit: detail?.nativeAgentLimit ?? world.nativeAgentLimit,
    nativeCreationState: (detail?.nativeCreationState ?? world.nativeCreationState) as XianxiaWorldData['nativeCreationState'],
    scoreA: detail?.scoreA ?? world.scoreA,
    scoreC: detail?.scoreC ?? world.scoreC,
    scoreE: detail?.scoreE ?? world.scoreE,
    scoreEwma: detail?.scoreEwma ?? world.scoreEwma,
    scoreQ: detail?.scoreQ ?? world.scoreQ,
    timeFlowRatio: detail?.timeFlowRatio ?? world.timeFlowRatio,
    transitInLimit: detail?.transitInLimit ?? world.transitInLimit,
    // Fields only available from detail API
    genre: detail?.genre ?? world.genre,
    era: detail?.era ?? world.era,
    themes: detail?.themes ?? world.themes,
    clockConfig: (detail as Record<string, unknown> | undefined)?.clockConfig as Record<string, unknown> | null ?? null,
    sceneTimeConfig: (detail as Record<string, unknown> | undefined)?.sceneTimeConfig as Record<string, unknown> | null ?? null,
    // Mock data — API 无对应字段，保留并标注 *
    subtitle: '山海暗涌，灵脉苏醒。一个凡人也能以心性、算计与机缘，穿越门派、秘境、乱星海与飞升之路。',
    quote: '凡人亦可问长生，天地无情，道途自争。',
    narrative: '这个 World 并不是一个静态的小说展厅，而是一个不断生长的修真生态。主世界以《凡人修仙传》的秩序感为底色：资源稀缺、机缘有限、修士谨慎、强者为尊、宗门与散修并存、秘境与拍卖场交替拉动剧情。\n\n在这里，用户并不只是旁观者，而是会影响世界变量的参与者。你可以让 Agent 扮演引路人、护法、执事、交易中介、秘境情报员、宗门长老或敌对势力代表；也可以让子世界承载特定地图、剧情线、宗门分舵、洞府系统、拍卖会系统和成长任务。\n\n整个首页模板强调"开放式"和"沉浸式"：世界信息清晰可读，评分总览一图展示，Agent 可随时进入聊天或语音，大事件沿时间轴推进，让用户一进入页面就有身处修真世界入口的感觉。',
  };
}

// Safely traverse nested object path
function nested(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// Convert API agent records to WorldAgent format
// API structure: { id, description, dna: { identity: { name, role, summary }, personality: { summary }, appearance: { avatarUrl? } } }
function toWorldAgent(raw: Record<string, unknown>, fallbackCreatedAt: string): WorldAgent {
  const name = String(nested(raw, 'dna', 'identity', 'name') || raw.name || 'Unknown');
  const role = String(nested(raw, 'dna', 'identity', 'role') || '');
  const identitySummary = String(nested(raw, 'dna', 'identity', 'summary') || '');
  const personalitySummary = String(nested(raw, 'dna', 'personality', 'summary') || '');
  const description = typeof raw.description === 'string' ? raw.description : '';

  // bio: prefer top-level description, fall back to identity summary or personality summary
  const bio = description || identitySummary || personalitySummary || 'No description available.';

  // avatarUrl: check appearance.avatarUrl, then top-level
  const avatarUrl = String(nested(raw, 'dna', 'appearance', 'avatarUrl') || raw.avatarUrl || '');

  return {
    id: String(raw.id || ''),
    name,
    handle: role ? `@${role}` : `@${name}`,
    bio,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : fallbackCreatedAt,
    avatarUrl: avatarUrl || undefined,
  };
}

// Map eventHorizon to display tag
const EVENT_HORIZON_TAG: Record<string, string> = {
  PAST: 'Past',
  ONGOING: 'Ongoing',
  FUTURE: 'Future',
};

// Convert API event records to WorldEvent format
function toWorldEvent(raw: Record<string, unknown>): WorldEvent {
  const horizon = typeof raw.eventHorizon === 'string' ? raw.eventHorizon : '';
  return {
    id: String(raw.id || ''),
    title: String(raw.title || 'Untitled Event'),
    description: String(raw.summary || raw.cause || raw.process || raw.result || ''),
    time: String(raw.timeRef || raw.createdAt || ''),
    tag: EVENT_HORIZON_TAG[horizon] || horizon || 'Event',
  };
}

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
};

export function WorldDetail({ world, onBack }: WorldDetailProps) {
  const authStatus = useAppStore((state) => state.auth.status);
  const isReady = authStatus === 'authenticated' && !!world.id;

  // Fetch full world detail (includes genre, era, themes, clockConfig, sceneTimeConfig)
  const worldDetailQuery = useQuery({
    queryKey: ['world-detail', world.id],
    queryFn: () => dataSync.loadWorldDetailById(world.id),
    enabled: isReady,
  });

  // Independent API call for world agents (mirrors WorldDetailPanel pattern)
  const worldAgentsQuery = useQuery({
    queryKey: ['world-agents', world.id],
    queryFn: async () => {
      const agents = await dataSync.loadWorldAgents(world.id);
      return agents.map((raw) => toWorldAgent(raw, world.createdAt));
    },
    enabled: isReady,
  });

  // Independent API call for world events (Chronicle)
  const worldEventsQuery = useQuery({
    queryKey: ['world-events', world.id],
    queryFn: async () => {
      const events = await dataSync.loadWorldEvents(world.id);
      return events.map(toWorldEvent);
    },
    enabled: isReady,
  });

  const worldData = toXianxiaWorldData(world, worldDetailQuery.data);
  const agents = worldAgentsQuery.data || [];
  const events = worldEventsQuery.data || [];

  const handleChatAgent = (agent: WorldAgent) => {
    console.log('Enter chat with agent:', agent);
  };

  const handleVoiceAgent = (agent: WorldAgent) => {
    console.log('Voice call with agent:', agent);
  };

  const handleEnterEdit = () => {
    console.log('Enter world editor:', world.id);
  };

  const handleCreateSubWorld = () => {
    console.log('Create sub-world:', world.id);
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f8fafb]">
      {/* Back button */}
      <div className="sticky top-0 z-50 px-4 py-3 bg-[#0a0f0c] border-b border-[#4ECCA3]/10">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4ECCA3]/10 border border-[#4ECCA3]/30 text-sm font-semibold text-[#4ECCA3] hover:bg-[#4ECCA3]/20 transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to List
        </button>
      </div>

      <XianxiaWorldTemplate
        world={worldData}
        agents={agents}
        events={events}
        agentsLoading={worldAgentsQuery.isPending}
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
