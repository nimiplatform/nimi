import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { LookdevAgentTruthBundle } from '@renderer/data/lookdev-data-client.js';
import type { LookdevRuntimeTargetOption } from './lookdev-route.js';
import type {
  LookdevAgentImportance,
  LookdevCaptureFeelingAnchor,
  LookdevCaptureMode,
  LookdevCaptureState,
  LookdevCaptureStateMessage,
  LookdevCaptureVisualIntent,
  LookdevCaptureWorkingMemory,
  LookdevLanguage,
  LookdevPortraitBrief,
  LookdevWorldStylePack,
} from './types.js';

type CaptureSeedAgent = {
  id: string;
  displayName: string;
  concept: string;
  description: string | null;
  truthBundle?: LookdevAgentTruthBundle | null;
  worldId: string | null;
  importance: LookdevAgentImportance;
  existingPortraitUrl?: string | null;
};

type CaptureHarnessTarget = Pick<LookdevRuntimeTargetOption, 'route' | 'connectorId' | 'modelId'>;

type CaptureEnvelope = {
  currentBrief: string;
  sourceSummary: string;
  feelingAnchor: {
    coreVibe: string;
    tonePhrases?: string[];
    avoidVibe?: string[];
  };
  workingMemory: {
    effectiveIntentSummary: string;
    preserveFocus?: string[];
    adjustFocus?: string[];
    negativeConstraints?: string[];
  };
  visualIntent: {
    visualRole: string;
    silhouette: string;
    outfit: string;
    hairstyle: string;
    palettePrimary: string;
    artStyle: string;
    mustKeepTraits?: string[];
    forbiddenTraits?: string[];
    detailBudget?: string;
    backgroundWeight?: string;
  };
  assistantReply?: string;
};

type StructuredAttempt = {
  maxTokens: number;
  temperature: number;
};

const CAPTURE_ATTEMPTS: StructuredAttempt[] = [
  { temperature: 0.2, maxTokens: 1800 },
  { temperature: 0.1, maxTokens: 2400 },
  { temperature: 0, maxTokens: 3200 },
];

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeStringList(values: unknown, maxItems = 8): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized: string[] = [];
  for (const value of values) {
    const item = normalizeText(value);
    if (!item || normalized.includes(item)) {
      continue;
    }
    normalized.push(item);
    if (normalized.length >= maxItems) {
      break;
    }
  }
  return normalized;
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('LOOKDEV_CAPTURE_JSON_EMPTY');
  }
  const withoutFence = trimmed
    .replace(/^```json\s*/iu, '')
    .replace(/^```\s*/u, '')
    .replace(/\s*```$/u, '');
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('LOOKDEV_CAPTURE_JSON_OBJECT_REQUIRED');
  }
  const parsed = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LOOKDEV_CAPTURE_JSON_OBJECT_REQUIRED');
  }
  return parsed as Record<string, unknown>;
}

function inferDetailBudget(importance: LookdevAgentImportance, captureMode: LookdevCaptureMode): LookdevCaptureVisualIntent['detailBudget'] {
  if (captureMode === 'capture' || importance === 'PRIMARY') {
    return 'hero';
  }
  if (importance === 'SECONDARY') {
    return 'standard';
  }
  return 'lean';
}

function inferBackgroundWeight(importance: LookdevAgentImportance): LookdevCaptureVisualIntent['backgroundWeight'] {
  return importance === 'BACKGROUND' ? 'minimal' : 'supporting';
}

function defaultSourceConfidence(agent: CaptureSeedAgent): LookdevCaptureState['sourceConfidence'] {
  const hasStructuredTruth = Boolean(
    agent.truthBundle
    && (
      normalizeText(agent.truthBundle.dna.identity.role)
      || normalizeText(agent.truthBundle.dna.identity.summary)
      || normalizeText(agent.truthBundle.dna.appearance.fashionStyle)
      || normalizeText(agent.truthBundle.dna.appearance.hair)
      || normalizeText(agent.truthBundle.soulPrime?.text)
    ),
  );
  return hasStructuredTruth || (normalizeText(agent.concept) && normalizeText(agent.description))
    ? 'derived_from_agent_truth'
    : 'world_style_fallback';
}

function defaultFeelingAnchor(language: LookdevLanguage): LookdevCaptureFeelingAnchor {
  return {
    coreVibe: language === 'zh' ? '尚未稳定' : 'Not stable yet',
    tonePhrases: [],
    avoidVibe: [],
  };
}

function defaultWorkingMemory(language: LookdevLanguage): LookdevCaptureWorkingMemory {
  return {
    effectiveIntentSummary: language === 'zh' ? '尚未整理' : 'Not organized yet',
    preserveFocus: [],
    adjustFocus: [],
    negativeConstraints: [],
  };
}

function defaultVisualIntent(input: {
  agent: CaptureSeedAgent;
  worldStylePack: LookdevWorldStylePack;
  captureMode: LookdevCaptureMode;
}): LookdevCaptureVisualIntent {
  const truth = input.agent.truthBundle;
  const visualRole = normalizeText(
    truth?.dna.identity.role
    || truth?.dna.identity.summary
    || input.agent.concept,
  );
  const appearance = truth?.dna.appearance;
  const biological = truth?.dna.biological;
  const concept = normalizeText(input.agent.concept);
  const description = normalizeText(
    input.agent.description
    || truth?.description
    || truth?.scenario
    || truth?.greeting,
  );
  const summary = description || concept || input.agent.displayName;
  const silhouetteTraits = [
    biological?.visualAge,
    biological?.gender,
    biological?.ethnicity,
    biological?.heightCm ? `${biological.heightCm}cm` : null,
    appearance?.fashionStyle,
  ].filter((value): value is string => Boolean(normalizeText(value)));
  const outfitAnchors = [
    normalizeText(appearance?.fashionStyle),
    ...((appearance?.signatureItems || []).map((item) => normalizeText(item)).filter(Boolean)),
  ];
  const mustKeepTraits = [
    concept,
    normalizeText(truth?.dna.identity.summary),
    normalizeText(appearance?.eyes),
    normalizeText(appearance?.skin),
    ...((appearance?.signatureItems || []).map((item) => normalizeText(item)).filter(Boolean)),
  ].filter(Boolean);
  return {
    visualRole: visualRole || input.agent.displayName,
    silhouette: silhouetteTraits.length > 0
      ? `${input.worldStylePack.silhouetteDirection}; ${silhouetteTraits.join(', ')}`
      : input.worldStylePack.silhouetteDirection,
    outfit: outfitAnchors.length > 0
      ? outfitAnchors.join(', ')
      : description || (input.worldStylePack.language === 'zh'
      ? `${input.worldStylePack.costumeDensity}的服装表达`
      : `${input.worldStylePack.costumeDensity} costume language aligned to the world lane`),
    hairstyle: normalizeText(appearance?.hair) || (input.worldStylePack.language === 'zh'
      ? '清晰、稳定、便于识别轮廓的发型'
      : 'clear hairstyle that preserves silhouette readability'),
    palettePrimary: input.worldStylePack.paletteDirection,
    artStyle: normalizeText(appearance?.artStyle) || input.worldStylePack.artStyle,
    mustKeepTraits: mustKeepTraits.length > 0 ? mustKeepTraits : [concept, summary].filter(Boolean),
    forbiddenTraits: [...input.worldStylePack.forbiddenElements],
    detailBudget: inferDetailBudget(input.agent.importance, input.captureMode),
    backgroundWeight: inferBackgroundWeight(input.agent.importance),
  };
}

function createMessage(role: LookdevCaptureStateMessage['role'], text: string): LookdevCaptureStateMessage {
  return {
    messageId: createId('lookdev-capture-msg'),
    role,
    text,
    createdAt: nowIso(),
  };
}

export function createCaptureStateKey(worldId: string | null | undefined, agentId: string): string {
  return `${String(worldId || 'unscoped').trim() || 'unscoped'}::${agentId}`;
}

export function buildCaptureSeedSignature(input: {
  agent: CaptureSeedAgent;
  worldStylePack: LookdevWorldStylePack;
  captureMode: LookdevCaptureMode;
}): string {
  return [
    normalizeText(input.agent.id),
    normalizeText(input.agent.worldId),
    normalizeText(input.agent.concept),
    normalizeText(input.worldStylePack.language),
    normalizeText(input.worldStylePack.name),
    normalizeText(input.worldStylePack.summary),
    normalizeText(input.worldStylePack.visualEra),
    normalizeText(input.worldStylePack.artStyle),
    normalizeText(input.worldStylePack.paletteDirection),
    normalizeText(input.worldStylePack.silhouetteDirection),
    normalizeText(input.captureMode),
  ].join('::');
}

function ensureCaptureTarget(target: CaptureHarnessTarget | null | undefined): CaptureHarnessTarget {
  if (!target?.modelId) {
    throw new Error('LOOKDEV_CAPTURE_TARGET_REQUIRED');
  }
  if (target.route === 'cloud' && !target.connectorId) {
    throw new Error('LOOKDEV_CAPTURE_TARGET_REQUIRED');
  }
  return target;
}

function generateTextWithTarget(input: {
  runtime: Runtime;
  target: CaptureHarnessTarget;
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ text: string; traceId?: string }> {
  return input.runtime.ai.text.generate({
    model: input.target.modelId,
    ...(input.target.route === 'cloud' && input.target.connectorId
      ? { connectorId: input.target.connectorId }
      : {}),
    route: input.target.route,
    system: input.system,
    input: input.prompt,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
  }).then((response) => {
    if (String(response.finishReason || '').trim() === 'length') {
      throw new Error('LOOKDEV_CAPTURE_RESPONSE_TRUNCATED');
    }
    return {
      text: String(response.text || ''),
      traceId: String(response.trace?.traceId || '').trim() || undefined,
    };
  });
}

function normalizeCaptureEnvelope(
  raw: string,
  fallback: {
    language: LookdevLanguage;
    agent: CaptureSeedAgent;
    worldStylePack: LookdevWorldStylePack;
    captureMode: LookdevCaptureMode;
  },
): CaptureEnvelope {
  const record = extractJsonObject(raw);
  const feelingAnchorRecord = record.feelingAnchor && typeof record.feelingAnchor === 'object' && !Array.isArray(record.feelingAnchor)
    ? record.feelingAnchor as Record<string, unknown>
    : {};
  const workingMemoryRecord = record.workingMemory && typeof record.workingMemory === 'object' && !Array.isArray(record.workingMemory)
    ? record.workingMemory as Record<string, unknown>
    : {};
  const visualIntentRecord = record.visualIntent && typeof record.visualIntent === 'object' && !Array.isArray(record.visualIntent)
    ? record.visualIntent as Record<string, unknown>
    : {};
  const defaultIntent = defaultVisualIntent(fallback);
  const envelope: CaptureEnvelope = {
    currentBrief: normalizeText(record.currentBrief),
    sourceSummary: normalizeText(record.sourceSummary),
    feelingAnchor: {
      coreVibe: normalizeText(feelingAnchorRecord.coreVibe) || defaultFeelingAnchor(fallback.language).coreVibe,
      tonePhrases: normalizeStringList(feelingAnchorRecord.tonePhrases, 3),
      avoidVibe: normalizeStringList(feelingAnchorRecord.avoidVibe, 4),
    },
    workingMemory: {
      effectiveIntentSummary: normalizeText(workingMemoryRecord.effectiveIntentSummary) || defaultWorkingMemory(fallback.language).effectiveIntentSummary,
      preserveFocus: normalizeStringList(workingMemoryRecord.preserveFocus, 8),
      adjustFocus: normalizeStringList(workingMemoryRecord.adjustFocus, 8),
      negativeConstraints: normalizeStringList(workingMemoryRecord.negativeConstraints, 8),
    },
    visualIntent: {
      visualRole: normalizeText(visualIntentRecord.visualRole) || defaultIntent.visualRole,
      silhouette: normalizeText(visualIntentRecord.silhouette) || defaultIntent.silhouette,
      outfit: normalizeText(visualIntentRecord.outfit) || defaultIntent.outfit,
      hairstyle: normalizeText(visualIntentRecord.hairstyle) || defaultIntent.hairstyle,
      palettePrimary: normalizeText(visualIntentRecord.palettePrimary) || defaultIntent.palettePrimary,
      artStyle: normalizeText(visualIntentRecord.artStyle) || defaultIntent.artStyle,
      mustKeepTraits: normalizeStringList(visualIntentRecord.mustKeepTraits, 8).length > 0
        ? normalizeStringList(visualIntentRecord.mustKeepTraits, 8)
        : defaultIntent.mustKeepTraits,
      forbiddenTraits: normalizeStringList(visualIntentRecord.forbiddenTraits, 8).length > 0
        ? normalizeStringList(visualIntentRecord.forbiddenTraits, 8)
        : defaultIntent.forbiddenTraits,
      detailBudget: ['lean', 'standard', 'hero'].includes(normalizeText(visualIntentRecord.detailBudget))
        ? normalizeText(visualIntentRecord.detailBudget) as LookdevCaptureVisualIntent['detailBudget']
        : defaultIntent.detailBudget,
      backgroundWeight: ['minimal', 'supporting', 'requested'].includes(normalizeText(visualIntentRecord.backgroundWeight))
        ? normalizeText(visualIntentRecord.backgroundWeight) as LookdevCaptureVisualIntent['backgroundWeight']
        : defaultIntent.backgroundWeight,
    },
    assistantReply: normalizeText(record.assistantReply) || undefined,
  };
  if (!envelope.currentBrief || !envelope.sourceSummary) {
    throw new Error('LOOKDEV_CAPTURE_CONTRACT_INVALID');
  }
  return envelope;
}

function finalizeVisualIntent(
  visualIntent: CaptureEnvelope['visualIntent'],
  fallback: LookdevCaptureVisualIntent,
): LookdevCaptureVisualIntent {
  return {
    visualRole: normalizeText(visualIntent.visualRole) || fallback.visualRole,
    silhouette: normalizeText(visualIntent.silhouette) || fallback.silhouette,
    outfit: normalizeText(visualIntent.outfit) || fallback.outfit,
    hairstyle: normalizeText(visualIntent.hairstyle) || fallback.hairstyle,
    palettePrimary: normalizeText(visualIntent.palettePrimary) || fallback.palettePrimary,
    artStyle: normalizeText(visualIntent.artStyle) || fallback.artStyle,
    mustKeepTraits: normalizeStringList(visualIntent.mustKeepTraits, 8).length > 0
      ? normalizeStringList(visualIntent.mustKeepTraits, 8)
      : fallback.mustKeepTraits,
    forbiddenTraits: normalizeStringList(visualIntent.forbiddenTraits, 8).length > 0
      ? normalizeStringList(visualIntent.forbiddenTraits, 8)
      : fallback.forbiddenTraits,
    detailBudget: ['lean', 'standard', 'hero'].includes(normalizeText(visualIntent.detailBudget))
      ? normalizeText(visualIntent.detailBudget) as LookdevCaptureVisualIntent['detailBudget']
      : fallback.detailBudget,
    backgroundWeight: ['minimal', 'supporting', 'requested'].includes(normalizeText(visualIntent.backgroundWeight))
      ? normalizeText(visualIntent.backgroundWeight) as LookdevCaptureVisualIntent['backgroundWeight']
      : fallback.backgroundWeight,
  };
}

function buildLanguageSystem(language: LookdevLanguage): string {
  return language === 'zh'
    ? '使用简体中文输出。只返回一个 JSON 对象，不要使用 markdown 代码块。'
    : 'Reply in English. Return one JSON object only, with no markdown fences.';
}

function buildSilentCaptureSystem(language: LookdevLanguage): string {
  if (language === 'zh') {
    return [
      '你在为 Lookdev 生成静默版单角色 capture state。',
      '先理解当前角色，再把这份角色理解整理成能驱动肖像生成的状态。',
      '优先把 creator-scoped detail 与 AgentRule truth 视为角色理解输入，而不是把它们直接改写成生图 prompt。',
      '不要机械拼接原始字段，不要把输出写成问卷答案。',
      'identity / biological / appearance truth 主要服务 visualIntent；soul prime / personality / communication truth 主要服务 feelingAnchor 与 workingMemory。',
      'scenario / greeting / behavioral rules 只做弱辅助，不要让它们压过 durable identity truth。',
      '如果已有 canonical portrait reference，可把它当作已有身份锚点，但不要机械复刻旧图。',
      '重点是人物主体、轮廓、服装、材质、配饰、道具、发型、色彩与画风，背景只做辅助。',
      'JSON 结构必须是 {"currentBrief":"string","sourceSummary":"string","feelingAnchor":{"coreVibe":"string","tonePhrases":["string"],"avoidVibe":["string"]},"workingMemory":{"effectiveIntentSummary":"string","preserveFocus":["string"],"adjustFocus":["string"],"negativeConstraints":["string"]},"visualIntent":{"visualRole":"string","silhouette":"string","outfit":"string","hairstyle":"string","palettePrimary":"string","artStyle":"string","mustKeepTraits":["string"],"forbiddenTraits":["string"],"detailBudget":"lean|standard|hero","backgroundWeight":"minimal|supporting|requested"}}。',
      'currentBrief 必须是一句自然语言角色肖像方向总结。',
      'sourceSummary 必须说明你如何从 Realm truth 和 world style lane 推导出这版角色理解。',
    ].join('\n');
  }
  return [
    'You are generating a silent single-agent capture state for Lookdev.',
    'Understand the current role first, then organize that role understanding into a state that can drive portrait generation.',
    'Treat creator-scoped detail and AgentRule truth as role-understanding inputs, not as a direct image prompt payload.',
    'Do not mechanically concatenate raw fields or produce a questionnaire-shaped answer.',
    'Identity, biological, and appearance truth should primarily shape visualIntent. Soul-prime, personality, and communication truth should primarily shape feelingAnchor and workingMemory.',
    'Scenario, greeting, and behavioral rules are weak supporting context and must not outweigh durable identity truth.',
    'If a canonical portrait reference already exists, treat it as a prior identity anchor without mechanically copying the old image.',
    'Prioritize character-facing decisions such as silhouette, outfit, materials, accessories, prop, hairstyle, palette, and art style. Background should remain supporting-only.',
    'The JSON shape must be {"currentBrief":"string","sourceSummary":"string","feelingAnchor":{"coreVibe":"string","tonePhrases":["string"],"avoidVibe":["string"]},"workingMemory":{"effectiveIntentSummary":"string","preserveFocus":["string"],"adjustFocus":["string"],"negativeConstraints":["string"]},"visualIntent":{"visualRole":"string","silhouette":"string","outfit":"string","hairstyle":"string","palettePrimary":"string","artStyle":"string","mustKeepTraits":["string"],"forbiddenTraits":["string"],"detailBudget":"lean|standard|hero","backgroundWeight":"minimal|supporting|requested"}}.',
    'currentBrief must be one natural-language portrait direction sentence.',
    'sourceSummary must explain how the role interpretation was derived from Realm truth and the world style lane.',
  ].join('\n');
}

function summarizeAgent(agent: CaptureSeedAgent, language: LookdevLanguage): string {
  const truth = agent.truthBundle;
  const identity = truth?.dna.identity;
  const biological = truth?.dna.biological;
  const appearance = truth?.dna.appearance;
  const personality = truth?.dna.personality;
  const communication = truth?.dna.communication;
  const sections = [
    `displayName: ${agent.displayName}`,
    `importance: ${agent.importance}`,
    `concept: ${normalizeText(agent.concept) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `description: ${normalizeText(agent.description) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `scenario: ${normalizeText(truth?.scenario) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `greeting: ${normalizeText(truth?.greeting) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `wakeStrategy: ${normalizeText(truth?.wakeStrategy) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `identityTruth: role=${normalizeText(identity?.role) || '-'}; worldview=${normalizeText(identity?.worldview) || '-'}; species=${normalizeText(identity?.species) || '-'}; summary=${normalizeText(identity?.summary) || '-'}`,
    `biologicalTruth: gender=${normalizeText(biological?.gender) || '-'}; visualAge=${normalizeText(biological?.visualAge) || '-'}; ethnicity=${normalizeText(biological?.ethnicity) || '-'}; heightCm=${biological?.heightCm ?? '-'}; weightKg=${biological?.weightKg ?? '-'}`,
    `appearanceTruth: artStyle=${normalizeText(appearance?.artStyle) || '-'}; hair=${normalizeText(appearance?.hair) || '-'}; eyes=${normalizeText(appearance?.eyes) || '-'}; skin=${normalizeText(appearance?.skin) || '-'}; fashionStyle=${normalizeText(appearance?.fashionStyle) || '-'}; signatureItems=${appearance?.signatureItems.join(', ') || '-'}`,
    `personalityTruth: summary=${normalizeText(personality?.summary) || '-'}; mbti=${normalizeText(personality?.mbti) || '-'}; interests=${personality?.interests.join(', ') || '-'}; goals=${personality?.goals.join(', ') || '-'}; relationshipMode=${normalizeText(personality?.relationshipMode) || '-'}; emotionBaseline=${normalizeText(personality?.emotionBaseline) || '-'}`,
    `communicationTruth: summary=${normalizeText(communication?.summary) || '-'}; responseLength=${normalizeText(communication?.responseLength) || '-'}; formality=${normalizeText(communication?.formality) || '-'}; sentiment=${normalizeText(communication?.sentiment) || '-'}`,
    `behavioralRules: ${truth?.behavioralRules.join(' | ') || (language === 'zh' ? '未提供' : 'not provided')}`,
    `appearanceRuleTruth: ${normalizeText(truth?.ruleTruth.appearance.statement) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `personalityRuleTruth: ${normalizeText(truth?.ruleTruth.personality.statement) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `communicationRuleTruth: ${normalizeText(truth?.ruleTruth.communication.statement) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `soulPrime: ${normalizeText(truth?.soulPrime?.text) || (language === 'zh' ? '未提供' : 'not provided')}`,
    `hasExistingPortrait: ${agent.existingPortraitUrl ? 'yes' : 'no'}`,
    `existingPortraitUrl: ${normalizeText(agent.existingPortraitUrl) || (language === 'zh' ? '未提供' : 'not provided')}`,
  ];
  return sections.join('\n');
}

function summarizeWorldStylePack(pack: LookdevWorldStylePack): string {
  return [
    `name: ${pack.name}`,
    `summary: ${pack.summary}`,
    `visualEra: ${pack.visualEra}`,
    `artStyle: ${pack.artStyle}`,
    `paletteDirection: ${pack.paletteDirection}`,
    `materialDirection: ${pack.materialDirection}`,
    `silhouetteDirection: ${pack.silhouetteDirection}`,
    `costumeDensity: ${pack.costumeDensity}`,
    `backgroundDirection: ${pack.backgroundDirection}`,
    `promptFrame: ${pack.promptFrame}`,
    `forbiddenElements: ${pack.forbiddenElements.join(', ') || '-'}`,
  ].join('\n');
}

function summarizeCaptureState(state: LookdevCaptureState): string {
  return [
    `currentBrief: ${state.currentBrief}`,
    `sourceSummary: ${state.sourceSummary}`,
    `feelingAnchor: core=${state.feelingAnchor.coreVibe}; tone=${state.feelingAnchor.tonePhrases.join(', ') || '-'}; avoid=${state.feelingAnchor.avoidVibe.join(', ') || '-'}`,
    `workingMemory: intent=${state.workingMemory.effectiveIntentSummary}; preserve=${state.workingMemory.preserveFocus.join(', ') || '-'}; adjust=${state.workingMemory.adjustFocus.join(', ') || '-'}; negative=${state.workingMemory.negativeConstraints.join(', ') || '-'}`,
    `visualIntent: role=${state.visualIntent.visualRole}; silhouette=${state.visualIntent.silhouette}; outfit=${state.visualIntent.outfit}; hairstyle=${state.visualIntent.hairstyle}; palette=${state.visualIntent.palettePrimary}; artStyle=${state.visualIntent.artStyle}; detailBudget=${state.visualIntent.detailBudget}; backgroundWeight=${state.visualIntent.backgroundWeight}`,
  ].join('\n');
}

async function generateStructuredCaptureEnvelope(input: {
  runtime: Runtime;
  target: CaptureHarnessTarget;
  system: string;
  prompt: string;
  fallback: {
    language: LookdevLanguage;
    agent: CaptureSeedAgent;
    worldStylePack: LookdevWorldStylePack;
    captureMode: LookdevCaptureMode;
  };
}): Promise<{ parsed: CaptureEnvelope; traceId?: string }> {
  let lastError: unknown = null;
  for (const attempt of CAPTURE_ATTEMPTS) {
    try {
      const response = await generateTextWithTarget({
        runtime: input.runtime,
        target: input.target,
        system: input.system,
        prompt: input.prompt,
        maxTokens: attempt.maxTokens,
        temperature: attempt.temperature,
      });
      return {
        parsed: normalizeCaptureEnvelope(response.text, input.fallback),
        traceId: response.traceId,
      };
    } catch (error) {
      lastError = error;
      if (String((error as Error)?.message || '').trim() !== 'LOOKDEV_CAPTURE_RESPONSE_TRUNCATED') {
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'LOOKDEV_CAPTURE_FAILED'));
}

export async function synthesizeSilentCaptureState(input: {
  runtime: Runtime;
  target: CaptureHarnessTarget | null | undefined;
  language: LookdevLanguage;
  agent: CaptureSeedAgent;
  worldStylePack: LookdevWorldStylePack;
  captureMode: LookdevCaptureMode;
  existingState?: LookdevCaptureState | null;
}): Promise<LookdevCaptureState> {
  const target = ensureCaptureTarget(input.target);
  const fallbackVisualIntent = defaultVisualIntent({
    agent: input.agent,
    worldStylePack: input.worldStylePack,
    captureMode: input.captureMode,
  });
  const prompt = [
    'agent',
    summarizeAgent(input.agent, input.language),
    '',
    'worldStylePack',
    summarizeWorldStylePack(input.worldStylePack),
    '',
    `captureMode: ${input.captureMode}`,
    `preferredLane: ${input.captureMode === 'capture' ? 'interactive' : 'silent'}`,
    input.existingState ? `existingCaptureState\n${summarizeCaptureState(input.existingState)}` : '',
  ].filter(Boolean).join('\n');
  const response = await generateStructuredCaptureEnvelope({
    runtime: input.runtime,
    target,
    system: `${buildLanguageSystem(input.language)}\n${buildSilentCaptureSystem(input.language)}`,
    prompt,
    fallback: {
      language: input.language,
      agent: input.agent,
      worldStylePack: input.worldStylePack,
      captureMode: input.captureMode,
    },
  });
  const timestamp = nowIso();
  const nextMode = input.captureMode === 'capture' ? 'interactive' : 'silent';
  return {
    agentId: input.agent.id,
    worldId: input.agent.worldId,
    displayName: input.agent.displayName,
    sourceConfidence: defaultSourceConfidence(input.agent),
    captureMode: input.captureMode,
    synthesisMode: nextMode,
    seedSignature: buildCaptureSeedSignature({
      agent: input.agent,
      worldStylePack: input.worldStylePack,
      captureMode: input.captureMode,
    }),
    currentBrief: response.parsed.currentBrief,
    sourceSummary: response.parsed.sourceSummary,
    feelingAnchor: {
      coreVibe: response.parsed.feelingAnchor.coreVibe,
      tonePhrases: response.parsed.feelingAnchor.tonePhrases || [],
      avoidVibe: response.parsed.feelingAnchor.avoidVibe || [],
    },
    workingMemory: {
      effectiveIntentSummary: response.parsed.workingMemory.effectiveIntentSummary,
      preserveFocus: response.parsed.workingMemory.preserveFocus || [],
      adjustFocus: response.parsed.workingMemory.adjustFocus || [],
      negativeConstraints: response.parsed.workingMemory.negativeConstraints || [],
    },
    visualIntent: finalizeVisualIntent(response.parsed.visualIntent, fallbackVisualIntent),
    messages: [createMessage('assistant', response.parsed.assistantReply || response.parsed.currentBrief)],
    lastTextTraceId: response.traceId || null,
    createdAt: input.existingState?.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function buildInteractiveCaptureSystem(language: LookdevLanguage): string {
  if (language === 'zh') {
    return [
      '你在为 Lookdev 的重点角色执行 interactive capture refinement。',
      '请像一个理解角色的协作者那样回应，而不是问卷机器人。',
      '你要在 creator-scoped detail、AgentRule truth、world style lane 与当前 capture state 之间做收敛，而不是直接拼原始字段。',
      '如果已有 canonical portrait reference，可把它当作已有身份锚点，但不要机械复刻旧图。',
      '你必须同时更新角色理解状态，并给出一句自然语言 assistantReply。',
      'assistantReply 要自然、短、具体，说明这轮保留什么、推进什么。',
      'JSON 结构必须是 {"assistantReply":"string","currentBrief":"string","sourceSummary":"string","feelingAnchor":{"coreVibe":"string","tonePhrases":["string"],"avoidVibe":["string"]},"workingMemory":{"effectiveIntentSummary":"string","preserveFocus":["string"],"adjustFocus":["string"],"negativeConstraints":["string"]},"visualIntent":{"visualRole":"string","silhouette":"string","outfit":"string","hairstyle":"string","palettePrimary":"string","artStyle":"string","mustKeepTraits":["string"],"forbiddenTraits":["string"],"detailBudget":"lean|standard|hero","backgroundWeight":"minimal|supporting|requested"}}。',
    ].join('\n');
  }
  return [
    'You are running interactive capture refinement for a focus character inside Lookdev.',
    'Respond like a role-aware collaborator, not a questionnaire bot.',
    'You must reconcile creator-scoped detail, AgentRule truth, the world style lane, and the current capture state instead of mechanically concatenating raw fields.',
    'If a canonical portrait reference already exists, treat it as a prior identity anchor without mechanically copying the old image.',
    'You must update the role understanding state and also produce one natural-language assistantReply.',
    'assistantReply should be short, concrete, and explain what is being preserved and pushed forward this round.',
    'The JSON shape must be {"assistantReply":"string","currentBrief":"string","sourceSummary":"string","feelingAnchor":{"coreVibe":"string","tonePhrases":["string"],"avoidVibe":["string"]},"workingMemory":{"effectiveIntentSummary":"string","preserveFocus":["string"],"adjustFocus":["string"],"negativeConstraints":["string"]},"visualIntent":{"visualRole":"string","silhouette":"string","outfit":"string","hairstyle":"string","palettePrimary":"string","artStyle":"string","mustKeepTraits":["string"],"forbiddenTraits":["string"],"detailBudget":"lean|standard|hero","backgroundWeight":"minimal|supporting|requested"}}.',
  ].join('\n');
}

export async function runInteractiveCaptureTurn(input: {
  runtime: Runtime;
  target: CaptureHarnessTarget | null | undefined;
  language: LookdevLanguage;
  agent: CaptureSeedAgent;
  worldStylePack: LookdevWorldStylePack;
  state: LookdevCaptureState;
  userMessage: string;
}): Promise<LookdevCaptureState> {
  const normalizedMessage = normalizeText(input.userMessage);
  if (!normalizedMessage) {
    throw new Error('LOOKDEV_CAPTURE_MESSAGE_REQUIRED');
  }
  const target = ensureCaptureTarget(input.target);
  const fallbackVisualIntent = defaultVisualIntent({
    agent: input.agent,
    worldStylePack: input.worldStylePack,
    captureMode: 'capture',
  });
  const prompt = [
    'agent',
    summarizeAgent(input.agent, input.language),
    '',
    'worldStylePack',
    summarizeWorldStylePack(input.worldStylePack),
    '',
    'currentCaptureState',
    summarizeCaptureState(input.state),
    '',
    'recentConversation',
    input.state.messages.slice(-6).map((message) => `${message.role}: ${message.text}`).join('\n'),
    '',
    `latestOperatorMessage: ${normalizedMessage}`,
  ].filter(Boolean).join('\n');
  const response = await generateStructuredCaptureEnvelope({
    runtime: input.runtime,
    target,
    system: `${buildLanguageSystem(input.language)}\n${buildInteractiveCaptureSystem(input.language)}`,
    prompt,
    fallback: {
      language: input.language,
      agent: input.agent,
      worldStylePack: input.worldStylePack,
      captureMode: 'capture',
    },
  });
  const timestamp = nowIso();
  return {
    ...input.state,
    captureMode: 'capture',
    synthesisMode: 'interactive',
    currentBrief: response.parsed.currentBrief,
    sourceSummary: response.parsed.sourceSummary,
    feelingAnchor: {
      coreVibe: response.parsed.feelingAnchor.coreVibe,
      tonePhrases: response.parsed.feelingAnchor.tonePhrases || [],
      avoidVibe: response.parsed.feelingAnchor.avoidVibe || [],
    },
    workingMemory: {
      effectiveIntentSummary: response.parsed.workingMemory.effectiveIntentSummary,
      preserveFocus: response.parsed.workingMemory.preserveFocus || [],
      adjustFocus: response.parsed.workingMemory.adjustFocus || [],
      negativeConstraints: response.parsed.workingMemory.negativeConstraints || [],
    },
    visualIntent: finalizeVisualIntent(response.parsed.visualIntent, fallbackVisualIntent),
    messages: [
      ...input.state.messages,
      createMessage('operator', normalizedMessage),
      createMessage('assistant', response.parsed.assistantReply || response.parsed.currentBrief),
    ],
    lastTextTraceId: response.traceId || null,
    updatedAt: timestamp,
  };
}

export function materializePortraitBriefFromCaptureState(state: LookdevCaptureState): LookdevPortraitBrief {
  return {
    agentId: state.agentId,
    worldId: state.worldId,
    displayName: state.displayName,
    visualRole: state.visualIntent.visualRole,
    silhouette: state.visualIntent.silhouette,
    outfit: state.visualIntent.outfit,
    hairstyle: state.visualIntent.hairstyle,
    palettePrimary: state.visualIntent.palettePrimary,
    artStyle: state.visualIntent.artStyle,
    mustKeepTraits: [...state.visualIntent.mustKeepTraits],
    forbiddenTraits: [...state.visualIntent.forbiddenTraits],
    sourceConfidence: state.sourceConfidence,
    updatedAt: state.updatedAt,
  };
}
