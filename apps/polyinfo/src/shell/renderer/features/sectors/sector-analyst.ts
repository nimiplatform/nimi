import type {
  AnalysisPackage,
  AnalysisSnapshot,
  AnalystMessage,
  DraftProposal,
  WindowKey,
} from '@renderer/data/types.js';

const PROPOSAL_BLOCK_PATTERN = /```polyinfo-proposal\s*([\s\S]*?)```/i;

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return result.length > 0 ? result : undefined;
}

export function buildAnalystSystemPrompt(input: {
  sectorLabel: string;
  sectorSlug: string;
  window: WindowKey;
  package: AnalysisPackage;
}): string {
  const normalizedMarkets = input.package.markets.map((market) => ({
    id: market.id,
    question: market.question,
    eventTitle: market.eventTitle,
    currentProbability: Number((market.currentProbability * 100).toFixed(2)),
    windowStartProbability: Number((market.windowStartProbability * 100).toFixed(2)),
    deltaPct: Number((market.delta * 100).toFixed(2)),
    volumeNum: Math.round(market.volumeNum),
    volume24hr: Math.round(market.volume24hr),
    liquidityNum: Math.round(market.liquidityNum),
    spread: market.spread,
    weightTier: market.weightTier,
    narrativeId: market.narrativeId ?? null,
    narrativeTitle: market.narrativeTitle ?? null,
    coreVariableIds: market.coreVariableIds,
    coreVariableTitles: market.coreVariableTitles,
  }));

  return [
    `你是 Polyinfo 的 sector analyst，当前负责板块 "${input.sectorLabel}" (${input.sectorSlug})。`,
    '你只能使用下面给出的盘口数据、已有 narrative、已有 core variable 和对话历史进行分析。',
    '不要引入新闻、社交媒体、现实背景知识或任何外部事件解释。只根据下注信息本身做判断。',
    `本轮分析窗口固定为 ${input.window}。`,
    '',
    '回答要求：',
    '1. 先直接给出判断，不要绕。',
    '2. 明确指出哪些盘口在主导这次判断，以及它们是怎样影响结论的。',
    '3. 如果市场内部出现分裂，要说清楚分裂发生在哪些盘口之间。',
    '4. 可以反驳用户，但仍然只能引用盘口事实。',
    '5. 默认使用中文回答。',
    '',
    '如果用户明确要求新增、修改、停用 narrative 或 core variable，或者要求重绑某个盘口，请在正常回答最后追加一个唯一的 proposal 代码块，格式必须完全如下：',
    '```polyinfo-proposal',
    '{"entityType":"narrative|core-variable|market-mapping","action":"create|update|deactivate|remap-market","title":"显示给用户的标题","definition":"一句定义","recordId":"已有对象 id，可选","marketId":"盘口 id，可选","narrativeId":"narrative id，可选","coreVariableIds":["cv-id-1"],"keywords":["keyword"],"note":"一句操作说明"}',
    '```',
    '如果本轮不需要结构修改，不要输出 proposal 代码块。',
    '',
    '当前结构化输入如下：',
    JSON.stringify({
      sector: input.package.sector,
      window: input.package.window,
      narratives: input.package.narratives,
      coreVariables: input.package.coreVariables,
      markets: normalizedMarkets,
    }),
  ].join('\n');
}

export function extractDraftProposal(text: string): { content: string; proposal: DraftProposal | null } {
  const match = text.match(PROPOSAL_BLOCK_PATTERN);
  if (!match) {
    return {
      content: text.trim(),
      proposal: null,
    };
  }

  const rawProposal = safeJsonParse(match[1] || '');
  const cleanedContent = text.replace(PROPOSAL_BLOCK_PATTERN, '').trim();

  if (!rawProposal || typeof rawProposal !== 'object' || Array.isArray(rawProposal)) {
    return {
      content: cleanedContent,
      proposal: null,
    };
  }

  const proposalRecord = rawProposal as Record<string, unknown>;
  const entityType = String(proposalRecord.entityType || '').trim();
  const action = String(proposalRecord.action || '').trim();

  if (!['narrative', 'core-variable', 'market-mapping'].includes(entityType)) {
    return { content: cleanedContent, proposal: null };
  }
  if (!['create', 'update', 'deactivate', 'remap-market'].includes(action)) {
    return { content: cleanedContent, proposal: null };
  }

  return {
    content: cleanedContent,
    proposal: {
      id: `proposal-${Date.now()}`,
      entityType: entityType as DraftProposal['entityType'],
      action: action as DraftProposal['action'],
      title: String(proposalRecord.title || '').trim() || '未命名提议',
      definition: proposalRecord.definition ? String(proposalRecord.definition) : undefined,
      keywords: normalizeStringArray(proposalRecord.keywords),
      recordId: proposalRecord.recordId ? String(proposalRecord.recordId) : undefined,
      marketId: proposalRecord.marketId ? String(proposalRecord.marketId) : undefined,
      narrativeId: proposalRecord.narrativeId ? String(proposalRecord.narrativeId) : undefined,
      coreVariableIds: normalizeStringArray(proposalRecord.coreVariableIds),
      note: proposalRecord.note ? String(proposalRecord.note) : undefined,
    },
  };
}

export function buildSnapshotFromAssistantMessage(input: {
  sectorSlug: string;
  sectorLabel: string;
  window: WindowKey;
  message: AnalystMessage;
}): AnalysisSnapshot | null {
  const content = input.message.content.trim();
  if (!content) {
    return null;
  }
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const headline = lines[0] || '最新分析';
  const summary = lines.slice(1).join(' ').trim() || headline;
  return {
    id: input.message.id,
    sectorSlug: input.sectorSlug,
    sectorLabel: input.sectorLabel,
    window: input.window,
    createdAt: input.message.createdAt,
    headline: headline.slice(0, 120),
    summary: summary.slice(0, 400),
    messageId: input.message.id,
  };
}
