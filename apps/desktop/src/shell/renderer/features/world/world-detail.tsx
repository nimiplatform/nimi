import { useTranslation } from 'react-i18next';
import { XianxiaWorldTemplate, type XianxiaWorldData } from './world-xianxia-template.js';
import type { WorldListItem } from './world-list.js';
import type { WorldAgent, WorldEvent } from './world-detail-template.js';

// Convert WorldListItem to XianxiaWorldData
function toXianxiaWorldData(world: WorldListItem): XianxiaWorldData {
  return {
    id: world.id,
    name: world.name, // Keep original name (Chinese)
    description: world.description,
    iconUrl: world.iconUrl,
    bannerUrl: world.bannerUrl,
    type: world.type === 'MAIN' ? 'MAIN' : 'SUB',
    status: world.status as XianxiaWorldData['status'],
    level: world.level,
    levelUpdatedAt: world.levelUpdatedAt,
    agentCount: world.agentCount,
    createdAt: world.createdAt,
    creatorId: world.creatorId,
    freezeReason: world.freezeReason as XianxiaWorldData['freezeReason'],
    lorebookEntryLimit: world.lorebookEntryLimit,
    nativeAgentLimit: world.nativeAgentLimit,
    nativeCreationState: world.nativeCreationState as XianxiaWorldData['nativeCreationState'],
    scoreA: world.scoreA,
    scoreC: world.scoreC,
    scoreE: world.scoreE,
    scoreEwma: world.scoreEwma,
    scoreQ: world.scoreQ,
    timeFlowRatio: world.timeFlowRatio,
    transitInLimit: world.transitInLimit,
    // Xianxia specific fields - Chinese quote/narrative for authenticity
    subtitle: '山海暗涌，灵脉苏醒。一个凡人也能以心性、算计与机缘，穿越门派、秘境、乱星海与飞升之路。',
    quote: '凡人亦可问长生，天地无情，道途自争。',
    narrative: '这个 World 并不是一个静态的小说展厅，而是一个不断生长的修真生态。主世界以《凡人修仙传》的秩序感为底色：资源稀缺、机缘有限、修士谨慎、强者为尊、宗门与散修并存、秘境与拍卖场交替拉动剧情。\n\n在这里，用户并不只是旁观者，而是会影响世界变量的参与者。你可以让 Agent 扮演引路人、护法、执事、交易中介、秘境情报员、宗门长老或敌对势力代表；也可以让子世界承载特定地图、剧情线、宗门分舵、洞府系统、拍卖会系统和成长任务。\n\n整个首页模板强调"开放式"和"沉浸式"：世界信息清晰可读，评分总览一图展示，Agent 可随时进入聊天或语音，大事件沿时间轴推进，让用户一进入页面就有身处修真世界入口的感觉。',
  };
}

// Convert world agents data to WorldAgent format
function getWorldAgents(world: WorldListItem): WorldAgent[] {
  // If world has agents data from API, use it
  if (world.agents && world.agents.length > 0) {
    return world.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      handle: agent.handle || `@${agent.name.toLowerCase().replace(/\s+/g, '.')}`,
      bio: agent.bio || 'No description available.',
      createdAt: agent.createdAt || world.createdAt,
      avatarUrl: agent.avatarUrl,
    }));
  }
  
  // Return empty array if no agents - UI will show "暂时没有数据"
  return [];
}

// Generate Xianxia-style event data - Chinese titles, English descriptions
function generateXianxiaEvents(world: WorldListItem): WorldEvent[] {
  return [
    {
      id: `event-${world.id}-1`,
      time: world.createdAt,
      title: '主世界「天南灵域」开启',
      tag: 'World Launch',
      description: 'World foundation construction complete. Spiritual vein nodes, sect forces, independent cultivator markets, secret realm entrances, and initial Agents all online. Main world enters ACTIVE state.',
    },
    {
      id: `event-${world.id}-2`,
      time: new Date(Date.now() - 86400000 * 25).toISOString(),
      title: '七玄门试炼场开放',
      tag: 'Newbie Event',
      description: 'Open to new users entering the world. Complete trials to unlock mortal cultivation growth routes, lightfoot techniques, and basic method branches.',
    },
    {
      id: `event-${world.id}-3`,
      time: new Date(Date.now() - 86400000 * 20).toISOString(),
      title: '黄枫谷收徒季开启',
      tag: 'Sect Route',
      description: 'Sect faction storyline officially launched. Users can make their first world-level choice among sects, independent cultivators, and neutral chambers of commerce, affecting subsequent Agent interactions.',
    },
    {
      id: `event-${world.id}-4`,
      time: new Date(Date.now() - 86400000 * 15).toISOString(),
      title: '血色禁地进入周期',
      tag: 'Secret Realm',
      description: 'Rare spiritual medicine and high-risk confrontation area opens. Activity Score and Engagement Score expected to enter high fluctuation range.',
    },
    {
      id: `event-${world.id}-5`,
      time: new Date(Date.now() - 86400000 * 10).toISOString(),
      title: '乱星海航路稳定',
      tag: 'Sub-world',
      description: 'Sub-world interface opened, cross-sea exploration, long-distance trade, and exotic branch plots connected. World now has MAIN + SUB expansion capability.',
    },
    {
      id: `event-${world.id}-6`,
      time: new Date(Date.now() - 86400000 * 3).toISOString(),
      title: '虚天殿异象预告',
      tag: 'Version Preview',
      description: 'High-level major event enters preview phase. Overall EWMA score rising. Auctions, contention battles, core formation resource drops, and governance voting systems to follow.',
    },
  ];
}

type WorldDetailProps = {
  world: WorldListItem;
  onBack: () => void;
};

export function WorldDetail({ world, onBack }: WorldDetailProps) {
  const { t } = useTranslation();
  
  const worldData = toXianxiaWorldData(world);
  const agents = getWorldAgents(world);
  const events = generateXianxiaEvents(world);

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
          {t('WorldDetail.backToList')}
        </button>
      </div>
      
      <XianxiaWorldTemplate
        world={worldData}
        agents={agents}
        events={events}
        onBack={onBack}
        onEnterEdit={handleEnterEdit}
        onCreateSubWorld={handleCreateSubWorld}
        onChatAgent={handleChatAgent}
        onVoiceAgent={handleVoiceAgent}
      />
    </div>
  );
}
