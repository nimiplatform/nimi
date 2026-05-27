import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { LookdevRuntimeTargetOption } from './lookdev-route.js';
import type {
  LookdevAgentImportance,
  LookdevLanguage,
  LookdevWorldStyleFocusKey,
  LookdevWorldStylePack,
  LookdevWorldStyleSession,
  LookdevWorldStyleSessionMessage,
  LookdevWorldStyleUnderstanding,
} from './types.js';

export type SessionAgentContext = {
  displayName: string;
  concept: string;
  importance: LookdevAgentImportance;
};

type LookdevStyleDialogueTarget = LookdevRuntimeTargetOption;

type WorldStyleStructuredAttempt = {
  maxTokens: number;
  temperature: number;
  recentMessageLimit: number;
  recentMessageMaxChars: number;
  castAgentLimit: number;
};

type WorldStyleDialogueEnvelope = {
  assistantReply: string;
  readiness: LookdevWorldStyleSession['status'];
  readinessReason?: string;
  summary: string;
  understanding: Partial<LookdevWorldStyleUnderstanding>;
  openQuestions?: string[];
};

type WorldStylePackEnvelope = {
  name: string;
  summary: string;
  visualEra: string;
  artStyle: string;
  paletteDirection: string;
  materialDirection: string;
  silhouetteDirection: string;
  costumeDensity: string;
  backgroundDirection: string;
  promptFrame: string;
  forbiddenElements: string[];
};

const WORLD_STYLE_FOCUS_KEYS: LookdevWorldStyleFocusKey[] = ['tone', 'differentiation', 'palette', 'forbidden'];

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createMessage(
  role: LookdevWorldStyleSessionMessage['role'],
  text: string,
): LookdevWorldStyleSessionMessage {
  return {
    messageId: createId('lookdev-style-msg'),
    role,
    text,
    createdAt: nowIso(),
  };
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function takeSnippet(value: string, fallback: string, max = 140): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return fallback;
  }
  return normalized.length > max ? `${normalized.slice(0, max - 1).trim()}…` : normalized;
}

function getDefaultUnderstanding(language: LookdevLanguage): LookdevWorldStyleUnderstanding {
  return {
    tone: language === 'zh' ? '尚未明确' : 'Not settled yet',
    differentiation: language === 'zh' ? '尚未明确' : 'Not settled yet',
    palette: language === 'zh' ? '尚未明确' : 'Not settled yet',
    forbidden: language === 'zh' ? '尚未明确' : 'Not settled yet',
  };
}

function getDefaultForbiddenElements(language: LookdevLanguage): string[] {
  return language === 'zh'
    ? ['极端近景', '剧烈动作姿态', '喧宾夺主的背景', '鱼眼畸变']
    : ['extreme close-up', 'dramatic action pose', 'busy cinematic background', 'fisheye distortion'];
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('LOOKDEV_STYLE_JSON_EMPTY');
  }
  const withoutFence = trimmed
    .replace(/^```json\s*/iu, '')
    .replace(/^```\s*/u, '')
    .replace(/\s*```$/u, '');
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('LOOKDEV_STYLE_JSON_OBJECT_REQUIRED');
  }
  const parsed = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LOOKDEV_STYLE_JSON_OBJECT_REQUIRED');
  }
  return parsed as Record<string, unknown>;
}

function normalizeOpenQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeReadiness(value: unknown): LookdevWorldStyleSession['status'] {
  return value === 'ready_to_synthesize' ? 'ready_to_synthesize' : 'collecting';
}

function normalizeUnderstanding(
  value: unknown,
  language: LookdevLanguage,
  previous: LookdevWorldStyleUnderstanding,
): LookdevWorldStyleUnderstanding {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const defaults = getDefaultUnderstanding(language);
  return {
    tone: normalizeText(record.tone) || previous.tone || defaults.tone,
    differentiation: normalizeText(record.differentiation) || previous.differentiation || defaults.differentiation,
    palette: normalizeText(record.palette) || previous.palette || defaults.palette,
    forbidden: normalizeText(record.forbidden) || previous.forbidden || defaults.forbidden,
  };
}

function parseWorldStyleDialogueEnvelope(
  raw: string,
  session: LookdevWorldStyleSession,
): WorldStyleDialogueEnvelope {
  const record = extractJsonObject(raw);
  const assistantReply = normalizeText(record.assistantReply);
  const summary = normalizeText(record.summary);
  if (!assistantReply) {
    throw new Error('LOOKDEV_STYLE_DIALOGUE_REPLY_REQUIRED');
  }
  if (!summary) {
    throw new Error('LOOKDEV_STYLE_DIALOGUE_SUMMARY_REQUIRED');
  }
  return {
    assistantReply,
    readiness: normalizeReadiness(record.readiness),
    readinessReason: normalizeText(record.readinessReason) || undefined,
    summary,
    understanding: normalizeUnderstanding(record.understanding, session.language, session.understanding),
    openQuestions: normalizeOpenQuestions(record.openQuestions),
  };
}

function parseWorldStylePackEnvelope(raw: string, language: LookdevLanguage): WorldStylePackEnvelope {
  const record = extractJsonObject(raw);
  const name = normalizeText(record.name);
  const summary = normalizeText(record.summary);
  const visualEra = normalizeText(record.visualEra);
  const artStyle = normalizeText(record.artStyle);
  const paletteDirection = normalizeText(record.paletteDirection);
  const materialDirection = normalizeText(record.materialDirection);
  const silhouetteDirection = normalizeText(record.silhouetteDirection);
  const costumeDensity = normalizeText(record.costumeDensity);
  const backgroundDirection = normalizeText(record.backgroundDirection);
  const promptFrame = normalizeText(record.promptFrame);
  const forbiddenElements = Array.isArray(record.forbiddenElements)
    ? record.forbiddenElements.map((item) => normalizeText(item)).filter(Boolean).slice(0, 6)
    : [];

  if (!name || !summary || !visualEra || !artStyle || !paletteDirection || !materialDirection || !silhouetteDirection || !costumeDensity || !backgroundDirection || !promptFrame) {
    throw new Error('LOOKDEV_STYLE_SYNTHESIS_CONTRACT_INVALID');
  }

  return {
    name,
    summary,
    visualEra,
    artStyle,
    paletteDirection,
    materialDirection,
    silhouetteDirection,
    costumeDensity,
    backgroundDirection,
    promptFrame,
    forbiddenElements: forbiddenElements.length > 0 ? forbiddenElements : getDefaultForbiddenElements(language),
  };
}

function summarizeCast(
  language: LookdevLanguage,
  agents: SessionAgentContext[],
  maxAgents = 6,
): string {
  if (agents.length === 0) {
    return language === 'zh'
      ? '当前 world 还没有可供整理的人物样本。'
      : 'No agent samples are currently available for this world.';
  }
  return agents
    .slice(0, maxAgents)
    .map((agent) => {
      const concept = normalizeText(agent.concept);
      if (language === 'zh') {
        return `${agent.displayName}（${agent.importance}）${concept ? `：${concept}` : ''}`;
      }
      return `${agent.displayName} (${agent.importance})${concept ? `: ${concept}` : ''}`;
    })
    .join(language === 'zh' ? '；' : '; ');
}

function summarizeRecentMessages(input: {
  session: LookdevWorldStyleSession;
  latestUserMessage?: string;
  maxMessages?: number;
  maxCharsPerMessage?: number;
}): string {
  const maxMessages = input.maxMessages ?? 8;
  const maxCharsPerMessage = input.maxCharsPerMessage ?? 220;
  const recent = input.session.messages.slice(-maxMessages).map((message) => ({
    role: message.role,
    text: takeSnippet(normalizeText(message.text), '', maxCharsPerMessage),
  })).filter((message) => message.text);
  if (input.latestUserMessage) {
    recent.push({
      role: 'operator',
      text: takeSnippet(normalizeText(input.latestUserMessage), '', maxCharsPerMessage),
    });
  }
  return recent
    .map((message) => `${message.role === 'assistant' ? 'assistant' : 'operator'}: ${message.text}`)
    .join('\n');
}

function buildDialogueSystem(language: LookdevLanguage): string {
  if (language === 'zh') {
    return [
      '你是 Lookdev 的 world style 协作助手。',
      '你的职责是理解操作者对世界观人物锚点肖像的描述，并把共识逐步整理成稳定可复用的 world 风格方向。',
      '你必须像协作者一样自然回应，不能机械列问题、不能像问卷、不能一次抛出一串字段清单。',
      '如果信息还不够，就只追问当前最关键的一个缺口；如果已经足够，就明确告诉对方现在可以整理 style pack，但仍允许继续细化。',
      '只输出 JSON 对象，不要输出额外解释。',
      'JSON 结构必须是 {"assistantReply":"string","readiness":"collecting|ready_to_synthesize","readinessReason":"string","summary":"string","understanding":{"tone":"string","differentiation":"string","palette":"string","forbidden":"string"},"openQuestions":["string"]}。',
      'assistantReply 必须自然、协作、简洁，长度不超过 140 个中文字符。',
      'summary 要概括当前世界人物锚点肖像共识，长度不超过 160 个中文字符。',
      'understanding 里的四个字段要写当前最新理解，不要简单复述用户原句。',
      'openQuestions 最多保留 3 条短问题；如果已经可以整理 style pack，可以留空数组。',
    ].join('\n');
  }
  return [
    'You are Lookdev, a collaborative world-style assistant.',
    'Your job is to understand the operator direction for anchor portraits in one world and keep converging it into a reusable style lane.',
    'Respond like a natural collaborator, not a questionnaire. Do not dump field lists or scripted interview prompts.',
    'If the direction is still missing something important, ask for only the single most useful next clarification. If the lane is already coherent, say it can be synthesized now while still inviting optional refinement.',
    'Return JSON only.',
    'The JSON shape must be {"assistantReply":"string","readiness":"collecting|ready_to_synthesize","readinessReason":"string","summary":"string","understanding":{"tone":"string","differentiation":"string","palette":"string","forbidden":"string"},"openQuestions":["string"]}.',
    'assistantReply must feel collaborative and concise, within 260 English characters.',
    'summary must capture the current world-style agreement within 220 English characters.',
    'The understanding fields must reflect the latest synthesized interpretation, not a verbatim echo.',
    'Keep openQuestions to at most 3 short items, and leave it empty when the lane is already ready to synthesize.',
  ].join('\n');
}

function buildDialoguePrompt(input: {
  session: LookdevWorldStyleSession;
  agents: SessionAgentContext[];
  latestUserMessage: string;
  recentMessageLimit?: number;
  recentMessageMaxChars?: number;
  castAgentLimit?: number;
}): string {
  const { session, agents, latestUserMessage } = input;
  const understanding = WORLD_STYLE_FOCUS_KEYS
    .map((key) => `${key}: ${session.understanding[key]}`)
    .join('\n');
  const sections = [
    `worldName: ${session.worldName}`,
    `language: ${session.language}`,
    `operatorTurnCount: ${session.operatorTurnCount + 1}`,
    `castSummary:\n${summarizeCast(session.language, agents, input.castAgentLimit ?? 6)}`,
    `currentUnderstanding:\n${understanding}`,
    `currentSummary:\n${normalizeText(session.summary) || 'not set yet'}`,
    `recentConversation:\n${summarizeRecentMessages({
      session,
      latestUserMessage,
      maxMessages: input.recentMessageLimit,
      maxCharsPerMessage: input.recentMessageMaxChars,
    })}`,
    `latestOperatorMessage:\n${normalizeText(latestUserMessage)}`,
  ];
  return sections.join('\n\n');
}

function buildSynthesisSystem(language: LookdevLanguage): string {
  if (language === 'zh') {
    return [
      '你要为 Lookdev 生成一份结构化的 world style pack 草案。',
      '这份草案必须来自当前世界风格会话的已收敛共识，不要发明与对话相冲突的新方向。',
      '只输出 JSON 对象，不要输出额外说明。',
      'JSON 结构必须是 {"name":"string","summary":"string","visualEra":"string","artStyle":"string","paletteDirection":"string","materialDirection":"string","silhouetteDirection":"string","costumeDensity":"string","backgroundDirection":"string","promptFrame":"string","forbiddenElements":["string"]}。',
      'summary 要说明这条 world 风格 lane 的核心气质与控制原则。',
      'promptFrame 必须保持全身角色锚点肖像、固定焦距、背景服从角色识别的方向。',
      'forbiddenElements 只保留 3 到 6 条最关键的禁区。',
    ].join('\n');
  }
  return [
    'Produce one structured world style pack draft for Lookdev.',
    'The draft must stay faithful to the current world-style conversation and should not invent a conflicting direction.',
    'Return JSON only.',
    'The JSON shape must be {"name":"string","summary":"string","visualEra":"string","artStyle":"string","paletteDirection":"string","materialDirection":"string","silhouetteDirection":"string","costumeDensity":"string","backgroundDirection":"string","promptFrame":"string","forbiddenElements":["string"]}.',
    'summary should explain the lane tone and control principles.',
    'promptFrame must preserve a full-body anchor portrait with fixed focal length and subdued background treatment.',
    'forbiddenElements should contain only the 3 to 6 most important lane-breaking moves.',
  ].join('\n');
}

function buildSynthesisPrompt(input: {
  session: LookdevWorldStyleSession;
  agents: SessionAgentContext[];
  existingPack?: LookdevWorldStylePack | null;
  recentMessageLimit?: number;
  recentMessageMaxChars?: number;
  castAgentLimit?: number;
}): string {
  const { session, agents, existingPack } = input;
  const understanding = WORLD_STYLE_FOCUS_KEYS
    .map((key) => `${key}: ${session.understanding[key]}`)
    .join('\n');
  return [
    `worldName: ${session.worldName}`,
    `language: ${session.language}`,
    `castSummary:\n${summarizeCast(session.language, agents, input.castAgentLimit ?? 6)}`,
    `conversationSummary:\n${normalizeText(session.summary) || 'not set yet'}`,
    `currentUnderstanding:\n${understanding}`,
    `recentConversation:\n${summarizeRecentMessages({
      session,
      maxMessages: input.recentMessageLimit,
      maxCharsPerMessage: input.recentMessageMaxChars,
    })}`,
    existingPack
      ? `existingDraftHint:\nname=${existingPack.name}\nvisualEra=${existingPack.visualEra}\npaletteDirection=${existingPack.paletteDirection}`
      : '',
  ].filter(Boolean).join('\n\n');
}

function ensureDialogueTarget(target: LookdevStyleDialogueTarget | null | undefined): LookdevStyleDialogueTarget {
  if (!target?.modelId) {
    throw new Error('LOOKDEV_STYLE_DIALOGUE_TARGET_REQUIRED');
  }
  if (target.route === 'cloud' && !target.connectorId) {
    throw new Error('LOOKDEV_STYLE_DIALOGUE_TARGET_REQUIRED');
  }
  return target;
}

async function generateTextWithTarget(input: {
  runtime: Runtime;
  target: LookdevStyleDialogueTarget;
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ text: string; traceId?: string }> {
  const response = await input.runtime.ai.text.generate({
    model: input.target.modelId,
    ...(input.target.route === 'cloud' && input.target.connectorId
      ? { connectorId: input.target.connectorId }
      : {}),
    route: input.target.route,
    system: input.system,
    input: input.prompt,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
  });
  if (String(response.finishReason || '').trim() === 'length') {
    throw new Error('LOOKDEV_STYLE_DIALOGUE_TRUNCATED');
  }
  return {
    text: String(response.text || ''),
    traceId: String(response.trace?.traceId || '').trim() || undefined,
  };
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'UNKNOWN_ERROR');
}

function shouldRetryWorldStyleStructuredAttempt(error: unknown): boolean {
  return normalizeErrorMessage(error) === 'LOOKDEV_STYLE_DIALOGUE_TRUNCATED';
}

async function generateStructuredWorldStyleObject<T>(input: {
  runtime: Runtime;
  target: LookdevStyleDialogueTarget;
  system: string;
  attempts: WorldStyleStructuredAttempt[];
  buildPrompt: (attempt: WorldStyleStructuredAttempt) => string;
  parse: (raw: string) => T;
}): Promise<{ parsed: T; traceId?: string }> {
  let lastError: unknown = null;
  for (const attempt of input.attempts) {
    try {
      const response = await generateTextWithTarget({
        runtime: input.runtime,
        target: input.target,
        system: input.system,
        prompt: input.buildPrompt(attempt),
        maxTokens: attempt.maxTokens,
        temperature: attempt.temperature,
      });
      return {
        parsed: input.parse(response.text),
        traceId: response.traceId,
      };
    } catch (error) {
      if (!shouldRetryWorldStyleStructuredAttempt(error)) {
        throw error instanceof Error ? error : new Error(normalizeErrorMessage(error));
      }
      lastError = error;
    }
  }
  const message = normalizeErrorMessage(lastError);
  throw lastError instanceof Error ? lastError : new Error(message);
}

const WORLD_STYLE_DIALOGUE_ATTEMPTS: WorldStyleStructuredAttempt[] = [
  { temperature: 0.2, maxTokens: 1600, recentMessageLimit: 8, recentMessageMaxChars: 220, castAgentLimit: 6 },
  { temperature: 0.1, maxTokens: 2400, recentMessageLimit: 6, recentMessageMaxChars: 180, castAgentLimit: 5 },
  { temperature: 0, maxTokens: 3200, recentMessageLimit: 4, recentMessageMaxChars: 140, castAgentLimit: 4 },
];

const WORLD_STYLE_SYNTHESIS_ATTEMPTS: WorldStyleStructuredAttempt[] = [
  { temperature: 0.1, maxTokens: 2200, recentMessageLimit: 8, recentMessageMaxChars: 220, castAgentLimit: 6 },
  { temperature: 0.05, maxTokens: 3000, recentMessageLimit: 6, recentMessageMaxChars: 180, castAgentLimit: 5 },
  { temperature: 0, maxTokens: 3800, recentMessageLimit: 4, recentMessageMaxChars: 140, castAgentLimit: 4 },
];

export function createWorldStyleSession(
  worldId: string,
  worldName: string,
  language: LookdevLanguage,
  agents: SessionAgentContext[],
): LookdevWorldStyleSession {
  const createdAt = nowIso();
  const leadNames = agents
    .filter((agent) => agent.importance === 'PRIMARY')
    .slice(0, 3)
    .map((agent) => agent.displayName)
    .filter(Boolean);
  const intro = language === 'zh'
    ? `我们先把 ${worldName} 的人物锚点肖像 lane 聊成一条可复用的世界风格。你可以直接描述感觉、人物差异、禁区，或拿 ${leadNames.join('、') || worldName} 举例，我会边理解边收敛。`
    : `Let's converge a reusable anchor-portrait lane for ${worldName}. You can describe tone, character differentiation, lane-breaking moves, or use ${leadNames.join(', ') || worldName} as examples, and I'll keep tightening the direction with you.`;

  return {
    sessionId: createId('lookdev-style-session'),
    worldId,
    worldName,
    language,
    status: 'collecting',
    messages: [createMessage('assistant', intro)],
    understanding: getDefaultUnderstanding(language),
    openQuestions: [],
    readinessReason: null,
    summary: null,
    operatorTurnCount: 0,
    lastTextTraceId: null,
    createdAt,
    updatedAt: createdAt,
    synthesizedAt: null,
  };
}

export async function appendWorldStyleSessionAnswer(input: {
  runtime: Runtime;
  target: LookdevStyleDialogueTarget | null | undefined;
  session: LookdevWorldStyleSession;
  answer: string;
  agents: SessionAgentContext[];
}): Promise<LookdevWorldStyleSession> {
  const normalizedAnswer = normalizeText(input.answer);
  if (!normalizedAnswer) {
    throw new Error('LOOKDEV_STYLE_SESSION_REPLY_REQUIRED');
  }
  const target = ensureDialogueTarget(input.target);
  const response = await generateStructuredWorldStyleObject({
    runtime: input.runtime,
    target,
    system: buildDialogueSystem(input.session.language),
    attempts: WORLD_STYLE_DIALOGUE_ATTEMPTS,
    buildPrompt: (attempt) => buildDialoguePrompt({
      session: input.session,
      agents: input.agents,
      latestUserMessage: normalizedAnswer,
      recentMessageLimit: attempt.recentMessageLimit,
      recentMessageMaxChars: attempt.recentMessageMaxChars,
      castAgentLimit: attempt.castAgentLimit,
    }),
    parse: (raw) => parseWorldStyleDialogueEnvelope(raw, input.session),
  });
  const envelope = response.parsed;
  return {
    ...input.session,
    status: envelope.readiness,
    messages: [
      ...input.session.messages,
      createMessage('operator', normalizedAnswer),
      createMessage('assistant', envelope.assistantReply),
    ],
    understanding: normalizeUnderstanding(envelope.understanding, input.session.language, input.session.understanding),
    openQuestions: envelope.openQuestions || [],
    readinessReason: normalizeText(envelope.readinessReason) || null,
    summary: envelope.summary,
    operatorTurnCount: input.session.operatorTurnCount + 1,
    lastTextTraceId: response.traceId || null,
    updatedAt: nowIso(),
  };
}

export async function synthesizeWorldStylePackFromSession(input: {
  runtime: Runtime;
  target: LookdevStyleDialogueTarget | null | undefined;
  session: LookdevWorldStyleSession;
  agents: SessionAgentContext[];
  existingPack?: LookdevWorldStylePack | null;
}): Promise<LookdevWorldStylePack> {
  if (input.session.operatorTurnCount < 1) {
    throw new Error('LOOKDEV_STYLE_SYNTHESIS_INPUT_REQUIRED');
  }
  const target = ensureDialogueTarget(input.target);
  const response = await generateStructuredWorldStyleObject({
    runtime: input.runtime,
    target,
    system: buildSynthesisSystem(input.session.language),
    attempts: WORLD_STYLE_SYNTHESIS_ATTEMPTS,
    buildPrompt: (attempt) => buildSynthesisPrompt({
      session: input.session,
      agents: input.agents,
      existingPack: input.existingPack,
      recentMessageLimit: attempt.recentMessageLimit,
      recentMessageMaxChars: attempt.recentMessageMaxChars,
      castAgentLimit: attempt.castAgentLimit,
    }),
    parse: (raw) => parseWorldStylePackEnvelope(raw, input.session.language),
  });
  const envelope = response.parsed;
  const now = nowIso();
  return {
    worldId: input.session.worldId,
    name: envelope.name,
    language: input.session.language,
    status: 'draft',
    seedSource: 'style_session',
    sourceSessionId: input.session.sessionId,
    summary: envelope.summary,
    visualEra: envelope.visualEra,
    artStyle: envelope.artStyle,
    paletteDirection: envelope.paletteDirection,
    materialDirection: envelope.materialDirection,
    silhouetteDirection: envelope.silhouetteDirection,
    costumeDensity: envelope.costumeDensity,
    backgroundDirection: envelope.backgroundDirection,
    promptFrame: envelope.promptFrame,
    forbiddenElements: envelope.forbiddenElements,
    createdAt: input.existingPack?.createdAt || now,
    updatedAt: now,
    confirmedAt: null,
  };
}

export function markWorldStyleSessionSynthesized(
  session: LookdevWorldStyleSession,
  summary: string,
  traceId?: string,
): LookdevWorldStyleSession {
  const timestamp = nowIso();
  return {
    ...session,
    status: 'synthesized',
    summary: normalizeText(summary) || session.summary,
    updatedAt: timestamp,
    synthesizedAt: timestamp,
    lastTextTraceId: traceId || session.lastTextTraceId,
  };
}

export function canSynthesizeWorldStyleSession(session: LookdevWorldStyleSession | null | undefined): boolean {
  return Boolean(session && session.operatorTurnCount > 0);
}

export function describeWorldStyleTarget(
  language: LookdevLanguage,
  target: LookdevStyleDialogueTarget | null | undefined,
): string {
  if (!target?.modelId) {
    return language === 'zh'
      ? '当前没有可用的 text.generate 目标'
      : 'No text.generate target is currently available';
  }
  if (target.route === 'local') {
    const model = normalizeText(target.modelLabel) || normalizeText(target.localModelId) || target.modelId;
    return language === 'zh'
      ? `本地 Runtime / ${model}`
      : `Local Runtime / ${model}`;
  }
  const connector = normalizeText(target.connectorLabel) || normalizeText(target.provider) || target.connectorId;
  const model = normalizeText(target.modelLabel) || target.modelId;
  return `${connector} / ${model}`;
}

export function buildWorldStylePackPreviewSummary(
  session: LookdevWorldStyleSession,
  pack: LookdevWorldStylePack | null | undefined,
): string {
  if (pack?.summary) {
    return pack.summary;
  }
  if (session.summary) {
    return session.summary;
  }
  if (session.language === 'zh') {
    return [
      `${session.worldName} 的人物锚点肖像应保持 ${takeSnippet(session.understanding.tone, '稳定世界气质')}。`,
      `角色差异主要通过 ${takeSnippet(session.understanding.differentiation, '身份与服装层次')} 呈现。`,
      `画面控制遵循 ${takeSnippet(session.understanding.palette, '角色优先的清晰识别')}。`,
      `必须避开 ${takeSnippet(session.understanding.forbidden, '极端近景和喧宾夺主的背景')}。`,
    ].join('');
  }
  return [
    `${session.worldName} anchor portraits should hold ${takeSnippet(session.understanding.tone, 'a stable world-authored tone')}.`,
    `Character differentiation should lean on ${takeSnippet(session.understanding.differentiation, 'role identity and costume hierarchy')}.`,
    `Palette control should follow ${takeSnippet(session.understanding.palette, 'character-first readability')}.`,
    `The lane must avoid ${takeSnippet(session.understanding.forbidden, 'extreme close-ups and distracting backgrounds')}.`,
  ].join(' ');
}
