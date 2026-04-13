import {
  AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
} from './chat-agent-behavior';
import type {
  AgentResolvedBehavior,
  AgentResolvedExperiencePolicy,
  AgentResolvedMessage,
  AgentResolvedMessageActionEnvelope,
  AgentResolvedModalityAction,
  AgentResolvedModalityActionPromptPayload,
  AgentResolvedTurnMode,
} from './chat-agent-behavior';
import type { AgentChatExperienceSettings } from './chat-settings-storage';

const QUESTION_RE = /[?？]|为什么|怎么|如何|能不能|可不可以|是什么|什么意思|怎样/u;
const EMOTIONAL_RE = /难过|好累|很累|烦|崩溃|想哭|孤单|害怕|抱抱|安慰|委屈|想你|心情不好|睡不着/u;
const PLAYFUL_RE = /哈哈|hh+|笑死|好耶|太好了|天啊|卧槽|嘿嘿|一起玩|烟花|庆祝|可爱/u;
const INTIMATE_RE = /亲|抱|想你|暧昧|恋人|喜欢你|爱你|想抱你|亲你一下|接吻/u;
const EXPLICIT_MEDIA_RE = /发图|来张图|发一张|看看你|照片|图片|视频|发个视频|自拍|给我看/u;
const EXPLICIT_VOICE_RE = /语音|说话|声音|读给我听|直接说|用语音/u;
const CHECKIN_RE = /^(在吗|早安|晚安|想你了|喂|hi|hello|hey|你好|嗨)[\s!,.?？！，。~]*$/iu;

const AGENT_ACTION_MODALITIES: ReadonlySet<AgentResolvedModalityAction['modality']> = new Set([
  'image',
  'voice',
  'video',
  'follow-up-turn',
]);
const AGENT_ACTION_DELIVERY_COUPLINGS: ReadonlySet<AgentResolvedModalityAction['deliveryCoupling']> = new Set([
  'after-message',
  'with-message',
]);
const AGENT_MODEL_OUTPUT_CLASSIFICATIONS = [
  'strict-json',
  'json-fenced',
  'json-wrapper',
  'plain-text',
  'partial-json',
  'invalid-json',
] as const;
const AGENT_MODEL_OUTPUT_RECOVERY_PATHS = [
  'none',
  'strip-fence',
  'extract-json-object',
  'plain-text-envelope',
] as const;

export type AgentModelOutputClassification = (typeof AGENT_MODEL_OUTPUT_CLASSIFICATIONS)[number];
export type AgentModelOutputRecoveryPath = (typeof AGENT_MODEL_OUTPUT_RECOVERY_PATHS)[number];
export type AgentPromptContextWindowSource = 'route-profile' | 'default-estimate';
export type AgentModelOutputUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
export type AgentImageExecutionDiagnostics = {
  textPlanningMs: number | null;
  imageJobSubmitMs: number | null;
  imageLoadMs: number | null;
  imageGenerateMs: number | null;
  artifactHydrateMs: number | null;
  queueWaitMs: number | null;
  loadCacheHit: boolean | null;
  residentReused: boolean | null;
  residentRestarted: boolean | null;
  queueSerialized: boolean | null;
  profileOverrideStep: number | null;
  profileOverrideCfgScale: number | null;
  profileOverrideSampler: string | null;
  profileOverrideScheduler: string | null;
};
export type AgentModelOutputDiagnostics = {
  classification: AgentModelOutputClassification;
  recoveryPath: AgentModelOutputRecoveryPath;
  suspectedTruncation: boolean;
  parseErrorDetail: string | null;
  rawOutputChars: number;
  normalizedOutputChars: number;
  finishReason: string | null;
  traceId: string | null;
  promptTraceId: string | null;
  usage: AgentModelOutputUsage | null;
  contextWindowSource: AgentPromptContextWindowSource;
  maxOutputTokensRequested: number | null;
  promptOverflow: boolean;
  requestPrompt: string | null;
  requestSystemPrompt: string | null;
  rawModelOutputText: string | null;
  normalizedModelOutputText: string | null;
  chainId: string | null;
  followUpDepth: number | null;
  maxFollowUpTurns: number | null;
  followUpCanceledByUser: boolean;
  followUpSourceActionId: string | null;
  image?: AgentImageExecutionDiagnostics | null;
};
export type ResolveAgentModelOutputEnvelopeInput = {
  modelOutput: string;
  requestPrompt?: string | null;
  requestSystemPrompt?: string | null;
  finishReason?: string | null;
  trace?: {
    traceId?: string | null;
    promptTraceId?: string | null;
  } | null;
  usage?: AgentModelOutputUsage;
  contextWindowSource: AgentPromptContextWindowSource;
  maxOutputTokensRequested?: number | null;
  promptOverflow: boolean;
};
export type ResolveAgentModelOutputEnvelopeResult =
  | {
    ok: true;
    envelope: AgentResolvedMessageActionEnvelope;
    diagnostics: AgentModelOutputDiagnostics;
  }
  | {
    ok: false;
    diagnostics: AgentModelOutputDiagnostics;
  };

export function resolveAgentTurnMode(userText: string): AgentResolvedTurnMode {
  const text = String(userText || '').trim();
  if (EXPLICIT_VOICE_RE.test(text)) return 'explicit-voice';
  if (EXPLICIT_MEDIA_RE.test(text)) return 'explicit-media';
  if (CHECKIN_RE.test(text)) return 'checkin';
  if (INTIMATE_RE.test(text)) return 'intimate';
  if (EMOTIONAL_RE.test(text)) return 'emotional';
  if (PLAYFUL_RE.test(text)) return 'playful';
  if (QUESTION_RE.test(text)) return 'information';
  return 'information';
}

export function resolveAgentExperiencePolicy(input: {
  turnMode: AgentResolvedTurnMode;
}): AgentResolvedExperiencePolicy {
  return {
    contentBoundary: input.turnMode === 'explicit-media' ? 'explicit-media-request' : 'default',
    autonomyPolicy: 'guarded',
  };
}

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseTrimmedString(value: unknown, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function parsePositiveInteger(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeMirroredCount(value: unknown, expectedCount: number): number {
  const normalized = Number(value);
  if (Number.isInteger(normalized) && normalized > 0 && normalized === expectedCount) {
    return normalized;
  }
  return expectedCount;
}

function parseActionModality(value: unknown, label: string): AgentResolvedModalityAction['modality'] {
  const modality = parseTrimmedString(value, label) as AgentResolvedModalityAction['modality'];
  if (!AGENT_ACTION_MODALITIES.has(modality)) {
    throw new Error(`${label} is invalid`);
  }
  return modality;
}

function parseActionDeliveryCoupling(
  value: unknown,
  label: string,
): AgentResolvedModalityAction['deliveryCoupling'] {
  const deliveryCoupling = parseTrimmedString(value, label) as AgentResolvedModalityAction['deliveryCoupling'];
  if (!AGENT_ACTION_DELIVERY_COUPLINGS.has(deliveryCoupling)) {
    throw new Error(`${label} is invalid`);
  }
  return deliveryCoupling;
}

function parsePromptPayload(
  value: unknown,
  modality: AgentResolvedModalityAction['modality'],
  label: string,
): AgentResolvedModalityActionPromptPayload {
  const record = parseRecord(value, label);
  const kind = parseTrimmedString(record.kind, `${label}.kind`);
  const promptText = parseTrimmedString(record.promptText, `${label}.promptText`);
  if (modality === 'image') {
    if (kind !== 'image-prompt') {
      throw new Error(`${label}.kind must match modality image`);
    }
    return { kind, promptText };
  }
  if (modality === 'voice') {
    if (kind !== 'voice-prompt') {
      throw new Error(`${label}.kind must match modality voice`);
    }
    return { kind, promptText };
  }
  if (modality === 'video') {
    if (kind !== 'video-prompt') {
      throw new Error(`${label}.kind must match modality video`);
    }
    return { kind, promptText };
  }
  if (kind !== 'follow-up-turn') {
    throw new Error(`${label}.kind must match modality follow-up-turn`);
  }
  return {
    kind,
    promptText,
    delayMs: parsePositiveInteger(record.delayMs, `${label}.delayMs`),
  };
}

function parseResolvedMessage(value: unknown): AgentResolvedMessage {
  const record = parseRecord(value, 'message');
  return {
    messageId: parseTrimmedString(record.messageId, 'message.messageId'),
    text: parseTrimmedString(record.text, 'message.text'),
  };
}

function parseResolvedModalityAction(
  value: unknown,
  actionArrayIndex: number,
  actionCount: number,
): AgentResolvedModalityAction {
  const record = parseRecord(value, `actions[${actionArrayIndex}]`);
  const modality = parseActionModality(record.modality, `actions[${actionArrayIndex}].modality`);
  const action = {
    actionId: parseTrimmedString(record.actionId, `actions[${actionArrayIndex}].actionId`),
    actionIndex: parseNonNegativeInteger(record.actionIndex, `actions[${actionArrayIndex}].actionIndex`),
    actionCount: normalizeMirroredCount(record.actionCount, actionCount),
    modality,
    operation: parseTrimmedString(record.operation, `actions[${actionArrayIndex}].operation`),
    promptPayload: parsePromptPayload(record.promptPayload, modality, `actions[${actionArrayIndex}].promptPayload`),
    sourceMessageId: parseTrimmedString(record.sourceMessageId, `actions[${actionArrayIndex}].sourceMessageId`),
    deliveryCoupling: parseActionDeliveryCoupling(
      record.deliveryCoupling,
      `actions[${actionArrayIndex}].deliveryCoupling`,
    ),
  } satisfies AgentResolvedModalityAction;
  if (action.actionIndex !== actionArrayIndex) {
    throw new Error(`actions[${actionArrayIndex}].actionIndex must equal ${actionArrayIndex}`);
  }
  if (action.actionCount !== actionCount) {
    throw new Error(`actions[${actionArrayIndex}].actionCount must equal ${actionCount}`);
  }
  return action;
}

function validatePhaseOneActionEnvelopeLimits(actions: readonly AgentResolvedModalityAction[]): void {
  let imageActionCount = 0;
  let voiceActionCount = 0;
  let followUpActionCount = 0;
  for (const action of actions) {
    if (action.modality === 'image') imageActionCount += 1;
    if (action.modality === 'voice') voiceActionCount += 1;
    if (action.modality === 'follow-up-turn') followUpActionCount += 1;
  }
  if (imageActionCount > 1) {
    throw new Error('agent-local-chat-v1 admits at most one image action in phase 0');
  }
  if (voiceActionCount > 1) {
    throw new Error('agent-local-chat-v1 admits at most one voice action in phase 1');
  }
  if (followUpActionCount > 1) {
    throw new Error('agent-local-chat-v1 admits at most one follow-up-turn action per turn');
  }
}

function parseAgentResolvedMessageActionEnvelopeFromPayload(payload: unknown): AgentResolvedMessageActionEnvelope {
  const record = parseRecord(payload, 'agent model output message-action envelope');
  const schemaId = parseTrimmedString(record.schemaId, 'schemaId');
  if (schemaId !== AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID) {
    throw new Error(`schemaId must equal ${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}`);
  }
  if (!record.message) {
    throw new Error('message is required');
  }
  if (!Array.isArray(record.actions)) {
    throw new Error('actions must be an array');
  }

  const message = parseResolvedMessage(record.message);
  const actionValues = record.actions as unknown[];
  const actions = actionValues.map((action, index) => parseResolvedModalityAction(action, index, actionValues.length));
  const actionIds = new Set<string>();
  for (const action of actions) {
    if (actionIds.has(action.actionId)) {
      throw new Error(`duplicate actionId: ${action.actionId}`);
    }
    actionIds.add(action.actionId);
    if (action.sourceMessageId !== message.messageId) {
      throw new Error(`action ${action.actionId} source message reference is inconsistent`);
    }
    if (action.modality === 'follow-up-turn' && action.operation !== 'assistant.turn.schedule') {
      throw new Error(`follow-up-turn action ${action.actionId} must use assistant.turn.schedule`);
    }
  }
  validatePhaseOneActionEnvelopeLimits(actions);
  return {
    schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
    message,
    actions,
  };
}

function normalizeModelOutputText(value: unknown): string {
  return String(value || '')
    .replace(/^\uFEFF+/u, '')
    .replace(/\r\n?/gu, '\n')
    .trim();
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeUsage(value: AgentModelOutputUsage | undefined): AgentModelOutputUsage | null {
  if (!value) {
    return null;
  }
  const inputTokens = Number(value.inputTokens);
  const outputTokens = Number(value.outputTokens);
  const totalTokens = Number(value.totalTokens);
  const normalized: AgentModelOutputUsage = {};
  if (Number.isFinite(inputTokens) && inputTokens >= 0) normalized.inputTokens = inputTokens;
  if (Number.isFinite(outputTokens) && outputTokens >= 0) normalized.outputTokens = outputTokens;
  if (Number.isFinite(totalTokens) && totalTokens >= 0) normalized.totalTokens = totalTokens;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseAgentImageExecutionDiagnostics(value: unknown): AgentImageExecutionDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const diagnostics: AgentImageExecutionDiagnostics = {
    textPlanningMs: normalizeOptionalNonNegativeNumber(record.textPlanningMs),
    imageJobSubmitMs: normalizeOptionalNonNegativeNumber(record.imageJobSubmitMs),
    imageLoadMs: normalizeOptionalNonNegativeNumber(record.imageLoadMs),
    imageGenerateMs: normalizeOptionalNonNegativeNumber(record.imageGenerateMs),
    artifactHydrateMs: normalizeOptionalNonNegativeNumber(record.artifactHydrateMs),
    queueWaitMs: normalizeOptionalNonNegativeNumber(record.queueWaitMs),
    loadCacheHit: normalizeOptionalBoolean(record.loadCacheHit),
    residentReused: normalizeOptionalBoolean(record.residentReused),
    residentRestarted: normalizeOptionalBoolean(record.residentRestarted),
    queueSerialized: normalizeOptionalBoolean(record.queueSerialized),
    profileOverrideStep: normalizeOptionalNonNegativeNumber(record.profileOverrideStep),
    profileOverrideCfgScale: normalizeOptionalNonNegativeNumber(record.profileOverrideCfgScale),
    profileOverrideSampler: normalizeNullableText(record.profileOverrideSampler),
    profileOverrideScheduler: normalizeNullableText(record.profileOverrideScheduler),
  };
  return Object.values(diagnostics).some((entry) => entry !== null) ? diagnostics : null;
}

function buildAgentModelOutputDiagnostics(input: {
  classification: AgentModelOutputClassification;
  recoveryPath: AgentModelOutputRecoveryPath;
  suspectedTruncation: boolean;
  parseErrorDetail?: string | null;
  rawModelOutput: string;
  normalizedModelOutput: string;
  requestPrompt?: string | null;
  requestSystemPrompt?: string | null;
  chainId?: string | null;
  followUpDepth?: number | null;
  maxFollowUpTurns?: number | null;
  followUpCanceledByUser?: boolean;
  followUpSourceActionId?: string | null;
  finishReason?: string | null;
  trace?: {
    traceId?: string | null;
    promptTraceId?: string | null;
  } | null;
  usage?: AgentModelOutputUsage;
  contextWindowSource: AgentPromptContextWindowSource;
  maxOutputTokensRequested?: number | null;
  promptOverflow: boolean;
}): AgentModelOutputDiagnostics {
  return {
    classification: input.classification,
    recoveryPath: input.recoveryPath,
    suspectedTruncation: input.suspectedTruncation,
    parseErrorDetail: normalizeNullableText(input.parseErrorDetail),
    rawOutputChars: String(input.rawModelOutput || '').length,
    normalizedOutputChars: String(input.normalizedModelOutput || '').length,
    finishReason: normalizeNullableText(input.finishReason),
    traceId: normalizeNullableText(input.trace?.traceId),
    promptTraceId: normalizeNullableText(input.trace?.promptTraceId),
    usage: normalizeUsage(input.usage),
    contextWindowSource: input.contextWindowSource,
    maxOutputTokensRequested: normalizeOptionalPositiveInteger(input.maxOutputTokensRequested),
    promptOverflow: Boolean(input.promptOverflow),
    requestPrompt: normalizeNullableText(input.requestPrompt),
    requestSystemPrompt: normalizeNullableText(input.requestSystemPrompt),
    rawModelOutputText: typeof input.rawModelOutput === 'string' ? input.rawModelOutput : null,
    normalizedModelOutputText: typeof input.normalizedModelOutput === 'string' ? input.normalizedModelOutput : null,
    chainId: normalizeNullableText(input.chainId),
    followUpDepth: normalizeOptionalPositiveInteger(input.followUpDepth),
    maxFollowUpTurns: normalizeOptionalPositiveInteger(input.maxFollowUpTurns),
    followUpCanceledByUser: input.followUpCanceledByUser === true,
    followUpSourceActionId: normalizeNullableText(input.followUpSourceActionId),
    image: null,
  };
}

function stripFencedJsonBlock(rawModelOutput: string): string | null {
  const match = rawModelOutput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (!match) {
    return null;
  }
  return normalizeModelOutputText(match[1] || '');
}

function extractSingleWrappedJsonObject(rawModelOutput: string): string | null {
  let startIndex = -1;
  let curlyDepth = 0;
  let squareDepth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < rawModelOutput.length; index += 1) {
    const char = rawModelOutput[index];
    if (startIndex === -1) {
      if (char === '{') {
        startIndex = index;
        curlyDepth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      curlyDepth += 1;
      continue;
    }
    if (char === '}') {
      curlyDepth -= 1;
      if (curlyDepth === 0 && squareDepth === 0) {
        const before = rawModelOutput.slice(0, startIndex).trim();
        const after = rawModelOutput.slice(index + 1).trim();
        if (!before && !after) {
          return null;
        }
        return normalizeModelOutputText(rawModelOutput.slice(startIndex, index + 1));
      }
      continue;
    }
    if (char === '[') {
      squareDepth += 1;
      continue;
    }
    if (char === ']') {
      squareDepth = Math.max(0, squareDepth - 1);
    }
  }
  return null;
}

function hasUnbalancedJsonDelimiters(rawModelOutput: string): boolean {
  let curlyDepth = 0;
  let squareDepth = 0;
  let inString = false;
  let escaped = false;
  for (const char of rawModelOutput) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      curlyDepth += 1;
      continue;
    }
    if (char === '}') {
      curlyDepth -= 1;
      continue;
    }
    if (char === '[') {
      squareDepth += 1;
      continue;
    }
    if (char === ']') {
      squareDepth -= 1;
    }
  }
  return curlyDepth !== 0 || squareDepth !== 0;
}

function looksLikeJsonAttempt(rawModelOutput: string): boolean {
  return rawModelOutput.startsWith('{')
    || rawModelOutput.startsWith('[')
    || rawModelOutput.startsWith('```')
    || rawModelOutput.includes('{"schemaId"')
    || rawModelOutput.includes('"schemaId"');
}

function isLikelyPartialJsonDetail(detail: string): boolean {
  const normalized = String(detail || '').trim().toLowerCase();
  return normalized.includes('unexpected end of json input')
    || normalized.includes('unexpected end of input')
    || normalized.includes("expected '}'")
    || normalized.includes("expected ']'")
    || normalized.includes('end of json input');
}

function classifyJsonFailure(rawModelOutput: string, detail: string): AgentModelOutputClassification {
  if (isLikelyPartialJsonDetail(detail) || hasUnbalancedJsonDelimiters(rawModelOutput)) {
    return 'partial-json';
  }
  return looksLikeJsonAttempt(rawModelOutput) ? 'invalid-json' : 'invalid-json';
}

function tryParseEnvelopeCandidate(rawModelOutput: string): {
  envelope: AgentResolvedMessageActionEnvelope | null;
  parseErrorDetail: string | null;
} {
  try {
    const payload = JSON.parse(rawModelOutput) as unknown;
    return {
      envelope: parseAgentResolvedMessageActionEnvelopeFromPayload(payload),
      parseErrorDetail: null,
    };
  } catch (error) {
    return {
      envelope: null,
      parseErrorDetail: error instanceof Error ? error.message : String(error || 'invalid JSON'),
    };
  }
}

export function parseAgentModelOutputDiagnostics(value: unknown): AgentModelOutputDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const classification = normalizeNullableText(record.classification) as AgentModelOutputClassification | null;
  const recoveryPath = normalizeNullableText(record.recoveryPath) as AgentModelOutputRecoveryPath | null;
  const contextWindowSource = normalizeNullableText(record.contextWindowSource) as AgentPromptContextWindowSource | null;
  if (
    !classification
    || !AGENT_MODEL_OUTPUT_CLASSIFICATIONS.includes(classification)
    || !recoveryPath
    || !AGENT_MODEL_OUTPUT_RECOVERY_PATHS.includes(recoveryPath)
    || !contextWindowSource
    || (contextWindowSource !== 'route-profile' && contextWindowSource !== 'default-estimate')
  ) {
    return null;
  }
  return {
    classification,
    recoveryPath,
    suspectedTruncation: record.suspectedTruncation === true,
    parseErrorDetail: normalizeNullableText(record.parseErrorDetail),
    rawOutputChars: Math.max(0, Number(record.rawOutputChars) || 0),
    normalizedOutputChars: Math.max(0, Number(record.normalizedOutputChars) || 0),
    finishReason: normalizeNullableText(record.finishReason),
    traceId: normalizeNullableText(record.traceId),
    promptTraceId: normalizeNullableText(record.promptTraceId),
    usage: normalizeUsage(record.usage as AgentModelOutputUsage | undefined),
    contextWindowSource,
    maxOutputTokensRequested: normalizeOptionalPositiveInteger(record.maxOutputTokensRequested),
    promptOverflow: record.promptOverflow === true,
    requestPrompt: normalizeNullableText(record.requestPrompt),
    requestSystemPrompt: normalizeNullableText(record.requestSystemPrompt),
    rawModelOutputText: normalizeNullableText(record.rawModelOutputText),
    normalizedModelOutputText: normalizeNullableText(record.normalizedModelOutputText),
    chainId: normalizeNullableText(record.chainId),
    followUpDepth: normalizeOptionalPositiveInteger(record.followUpDepth),
    maxFollowUpTurns: normalizeOptionalPositiveInteger(record.maxFollowUpTurns),
    followUpCanceledByUser: record.followUpCanceledByUser === true,
    followUpSourceActionId: normalizeNullableText(record.followUpSourceActionId),
    image: parseAgentImageExecutionDiagnostics(record.image),
  };
}

export function toAgentModelOutputTurnError(
  diagnostics: AgentModelOutputDiagnostics,
): { code: string; message: string } {
  if (diagnostics.suspectedTruncation) {
    return {
      code: 'AGENT_OUTPUT_INVALID',
      message: 'Agent response was truncated before the structured reply completed.',
    };
  }
  return {
    code: 'AGENT_OUTPUT_INVALID',
    message: 'Agent response format was invalid.',
  };
}

export function recoverPlainTextAsEnvelope(rawModelOutput: string): AgentResolvedMessageActionEnvelope | null {
  const text = rawModelOutput.trim();
  if (!text || text.startsWith('{') || text.startsWith('[') || text.startsWith('`')) {
    return null;
  }
  return {
    schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
    message: {
      messageId: 'message-0',
      text,
    },
    actions: [],
  };
}

export function resolveAgentModelOutputEnvelope(
  input: ResolveAgentModelOutputEnvelopeInput,
): ResolveAgentModelOutputEnvelopeResult {
  const rawModelOutput = String(input.modelOutput || '');
  const normalizedModelOutput = normalizeModelOutputText(rawModelOutput);
  const strictCandidate = tryParseEnvelopeCandidate(normalizedModelOutput);
  if (strictCandidate.envelope) {
    return {
      ok: true,
      envelope: strictCandidate.envelope,
      diagnostics: buildAgentModelOutputDiagnostics({
        classification: 'strict-json',
        recoveryPath: 'none',
        suspectedTruncation: false,
        rawModelOutput,
        normalizedModelOutput,
        finishReason: input.finishReason,
        trace: input.trace,
        usage: input.usage,
        contextWindowSource: input.contextWindowSource,
        maxOutputTokensRequested: input.maxOutputTokensRequested,
        promptOverflow: input.promptOverflow,
        requestPrompt: input.requestPrompt,
        requestSystemPrompt: input.requestSystemPrompt,
      }),
    };
  }

  const fencedCandidateText = stripFencedJsonBlock(normalizedModelOutput);
  if (fencedCandidateText) {
    const fencedCandidate = tryParseEnvelopeCandidate(fencedCandidateText);
    if (fencedCandidate.envelope) {
      return {
        ok: true,
        envelope: fencedCandidate.envelope,
        diagnostics: buildAgentModelOutputDiagnostics({
          classification: 'json-fenced',
          recoveryPath: 'strip-fence',
          suspectedTruncation: false,
          rawModelOutput,
          normalizedModelOutput,
          finishReason: input.finishReason,
          trace: input.trace,
          usage: input.usage,
          contextWindowSource: input.contextWindowSource,
          maxOutputTokensRequested: input.maxOutputTokensRequested,
          promptOverflow: input.promptOverflow,
          requestPrompt: input.requestPrompt,
          requestSystemPrompt: input.requestSystemPrompt,
        }),
      };
    }
  }

  const wrappedJsonObject = extractSingleWrappedJsonObject(normalizedModelOutput);
  if (wrappedJsonObject) {
    const wrappedCandidate = tryParseEnvelopeCandidate(wrappedJsonObject);
    if (wrappedCandidate.envelope) {
      return {
        ok: true,
        envelope: wrappedCandidate.envelope,
        diagnostics: buildAgentModelOutputDiagnostics({
          classification: 'json-wrapper',
          recoveryPath: 'extract-json-object',
          suspectedTruncation: false,
          rawModelOutput,
          normalizedModelOutput,
          finishReason: input.finishReason,
          trace: input.trace,
          usage: input.usage,
          contextWindowSource: input.contextWindowSource,
          maxOutputTokensRequested: input.maxOutputTokensRequested,
          promptOverflow: input.promptOverflow,
          requestPrompt: input.requestPrompt,
          requestSystemPrompt: input.requestSystemPrompt,
        }),
      };
    }
  }

  const plainTextEnvelope = recoverPlainTextAsEnvelope(normalizedModelOutput);
  if (plainTextEnvelope) {
    return {
      ok: true,
      envelope: plainTextEnvelope,
      diagnostics: buildAgentModelOutputDiagnostics({
        classification: 'plain-text',
        recoveryPath: 'plain-text-envelope',
        suspectedTruncation: false,
        rawModelOutput,
        normalizedModelOutput,
        finishReason: input.finishReason,
        trace: input.trace,
        usage: input.usage,
        contextWindowSource: input.contextWindowSource,
        maxOutputTokensRequested: input.maxOutputTokensRequested,
        promptOverflow: input.promptOverflow,
        requestPrompt: input.requestPrompt,
        requestSystemPrompt: input.requestSystemPrompt,
      }),
    };
  }

  const parseErrorDetail = normalizeNullableText(strictCandidate.parseErrorDetail)
    || normalizeNullableText(
      fencedCandidateText ? tryParseEnvelopeCandidate(fencedCandidateText).parseErrorDetail : null,
    )
    || normalizeNullableText(
      wrappedJsonObject ? tryParseEnvelopeCandidate(wrappedJsonObject).parseErrorDetail : null,
    );
  const suspectedTruncation = normalizeNullableText(input.finishReason) === 'length'
    || Boolean(parseErrorDetail && isLikelyPartialJsonDetail(parseErrorDetail))
    || hasUnbalancedJsonDelimiters(normalizedModelOutput);
  return {
    ok: false,
    diagnostics: buildAgentModelOutputDiagnostics({
      classification: classifyJsonFailure(normalizedModelOutput, parseErrorDetail || 'invalid JSON'),
      recoveryPath: 'none',
      suspectedTruncation,
      parseErrorDetail,
      rawModelOutput,
      normalizedModelOutput,
      finishReason: input.finishReason,
      trace: input.trace,
      usage: input.usage,
      contextWindowSource: input.contextWindowSource,
      maxOutputTokensRequested: input.maxOutputTokensRequested,
      promptOverflow: input.promptOverflow,
      requestPrompt: input.requestPrompt,
      requestSystemPrompt: input.requestSystemPrompt,
    }),
  };
}

export function parseAgentResolvedMessageActionEnvelope(modelOutput: string): AgentResolvedMessageActionEnvelope {
  const raw = String(modelOutput || '').trim();
  if (!raw) {
    throw new Error('Agent model output message-action envelope is required');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'invalid JSON');
    const hint = raw.startsWith('`')
      ? 'leading backticks detected; remove Markdown code fences and return the JSON object directly'
      : 'return the JSON object directly with no wrapper text';
    throw new Error(
      `Agent model output must be a raw JSON object with no Markdown code fences or wrapper text: ${hint} (${detail})`,
      { cause: error },
    );
  }
  return parseAgentResolvedMessageActionEnvelopeFromPayload(payload);
}

export function buildAgentResolvedOutputText(envelope: AgentResolvedMessageActionEnvelope): string {
  return envelope.message.text.trim();
}

export function resolveAgentChatBehavior(input: {
  userText: string;
  settings: AgentChatExperienceSettings;
}): AgentResolvedBehavior {
  const resolvedTurnMode = resolveAgentTurnMode(input.userText);
  const resolvedExperiencePolicy = resolveAgentExperiencePolicy({
    turnMode: resolvedTurnMode,
  });
  return {
    settings: input.settings,
    resolvedTurnMode,
    resolvedExperiencePolicy,
  };
}
