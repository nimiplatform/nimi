import {
  AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID,
} from './chat-agent-behavior';
import type {
  AgentResolvedBeat,
  AgentResolvedBeatActionEnvelope,
  AgentResolvedBeatPlan,
  AgentResolvedBehavior,
  AgentResolvedExperiencePolicy,
  AgentResolvedModalityAction,
  AgentResolvedModalityActionPromptPayload,
  AgentResolvedTextBeat,
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
const AGENT_BEAT_INTENTS: ReadonlySet<AgentResolvedBeat['intent']> = new Set([
  'reply',
  'follow-up',
  'comfort',
  'checkin',
  'media-request',
  'voice-request',
]);
const AGENT_DELIVERY_PHASES: ReadonlySet<AgentResolvedBeat['deliveryPhase']> = new Set([
  'primary',
  'tail',
]);
const AGENT_ACTION_MODALITIES: ReadonlySet<AgentResolvedModalityAction['modality']> = new Set([
  'image',
  'voice',
  'video',
]);
const AGENT_ACTION_DELIVERY_COUPLINGS: ReadonlySet<AgentResolvedModalityAction['deliveryCoupling']> = new Set([
  'after-source-beat',
  'with-source-beat',
]);

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

function createBeat(input: {
  beatIndex: number;
  beatCount: number;
  intent: AgentResolvedBeat['intent'];
  deliveryPhase: AgentResolvedBeat['deliveryPhase'];
  delayMs?: number;
}): AgentResolvedBeat {
  return {
    beatId: `behavior-beat:${input.beatIndex}`,
    beatIndex: input.beatIndex,
    beatCount: input.beatCount,
    intent: input.intent,
    deliveryPhase: input.deliveryPhase,
    ...(input.delayMs ? { delayMs: input.delayMs } : {}),
  };
}

function resolvePrimaryBeatIntent(turnMode: AgentResolvedTurnMode): AgentResolvedBeat['intent'] {
  if (turnMode === 'explicit-media') {
    return 'media-request';
  }
  if (turnMode === 'explicit-voice') {
    return 'voice-request';
  }
  if (turnMode === 'emotional') {
    return 'comfort';
  }
  if (turnMode === 'checkin') {
    return 'checkin';
  }
  return 'reply';
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

function parseBeatIntent(value: unknown, label: string): AgentResolvedBeat['intent'] {
  const intent = parseTrimmedString(value, label) as AgentResolvedBeat['intent'];
  if (!AGENT_BEAT_INTENTS.has(intent)) {
    throw new Error(`${label} is invalid`);
  }
  return intent;
}

function parseDeliveryPhase(value: unknown, label: string): AgentResolvedBeat['deliveryPhase'] {
  const deliveryPhase = parseTrimmedString(value, label) as AgentResolvedBeat['deliveryPhase'];
  if (!AGENT_DELIVERY_PHASES.has(deliveryPhase)) {
    throw new Error(`${label} is invalid`);
  }
  return deliveryPhase;
}

function parseOptionalPositiveDelayMs(value: unknown, label: string): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  return parsePositiveInteger(value, label);
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
  const deliveryCoupling = parseTrimmedString(
    value,
    label,
  ) as AgentResolvedModalityAction['deliveryCoupling'];
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
  const expectedKind = modality === 'image'
    ? 'image-prompt'
    : modality === 'voice'
      ? 'voice-prompt'
      : 'video-prompt';
  if (kind !== expectedKind) {
    throw new Error(`${label}.kind must match modality ${modality}`);
  }
  return {
    kind: expectedKind,
    promptText,
  };
}

function parseResolvedTextBeat(
  value: unknown,
  beatArrayIndex: number,
  beatCount: number,
): AgentResolvedTextBeat {
  const record = parseRecord(value, `beats[${beatArrayIndex}]`);
  const beat = {
    beatId: parseTrimmedString(record.beatId, `beats[${beatArrayIndex}].beatId`),
    beatIndex: parseNonNegativeInteger(record.beatIndex, `beats[${beatArrayIndex}].beatIndex`),
    beatCount: parsePositiveInteger(record.beatCount, `beats[${beatArrayIndex}].beatCount`),
    intent: parseBeatIntent(record.intent, `beats[${beatArrayIndex}].intent`),
    deliveryPhase: parseDeliveryPhase(record.deliveryPhase, `beats[${beatArrayIndex}].deliveryPhase`),
    text: parseTrimmedString(record.text, `beats[${beatArrayIndex}].text`),
    delayMs: parseOptionalPositiveDelayMs(record.delayMs, `beats[${beatArrayIndex}].delayMs`),
  } satisfies AgentResolvedTextBeat;

  if (beat.beatIndex !== beatArrayIndex) {
    throw new Error(`beats[${beatArrayIndex}].beatIndex must equal ${beatArrayIndex}`);
  }
  if (beat.beatCount !== beatCount) {
    throw new Error(`beats[${beatArrayIndex}].beatCount must equal ${beatCount}`);
  }
  if (beatArrayIndex === 0 && beat.deliveryPhase !== 'primary') {
    throw new Error('beats[0].deliveryPhase must be primary');
  }
  if (beatArrayIndex > 0 && beat.deliveryPhase !== 'tail') {
    throw new Error(`beats[${beatArrayIndex}].deliveryPhase must be tail`);
  }
  if (beat.deliveryPhase === 'tail' && beat.delayMs === undefined) {
    throw new Error(`beats[${beatArrayIndex}].delayMs is required for delayed tail beats`);
  }
  if (beat.deliveryPhase === 'primary' && beat.delayMs !== undefined) {
    throw new Error(`beats[${beatArrayIndex}].delayMs is not allowed on the primary beat`);
  }
  return beat;
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
    actionCount: parsePositiveInteger(record.actionCount, `actions[${actionArrayIndex}].actionCount`),
    modality,
    operation: parseTrimmedString(record.operation, `actions[${actionArrayIndex}].operation`),
    promptPayload: parsePromptPayload(record.promptPayload, modality, `actions[${actionArrayIndex}].promptPayload`),
    sourceBeatId: parseTrimmedString(record.sourceBeatId, `actions[${actionArrayIndex}].sourceBeatId`),
    sourceBeatIndex: parseNonNegativeInteger(record.sourceBeatIndex, `actions[${actionArrayIndex}].sourceBeatIndex`),
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

export function parseAgentResolvedBeatActionEnvelope(modelOutput: string): AgentResolvedBeatActionEnvelope {
  const raw = String(modelOutput || '').trim();
  if (!raw) {
    throw new Error('Agent model output beat-action envelope is required');
  }
  const payload = JSON.parse(raw) as unknown;
  const record = parseRecord(payload, 'agent model output beat-action envelope');
  const schemaId = parseTrimmedString(record.schemaId, 'schemaId');
  if (schemaId !== AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID) {
    throw new Error(`schemaId must equal ${AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID}`);
  }

  if (!Array.isArray(record.beats) || record.beats.length === 0) {
    throw new Error('beats must be a non-empty array');
  }
  if (!Array.isArray(record.actions)) {
    throw new Error('actions must be an array');
  }
  const beatValues = record.beats as unknown[];
  const actionValues = record.actions as unknown[];

  const beats = beatValues.map((beat, index) => parseResolvedTextBeat(beat, index, beatValues.length));
  const beatIds = new Set<string>();
  for (const beat of beats) {
    if (beatIds.has(beat.beatId)) {
      throw new Error(`duplicate beatId: ${beat.beatId}`);
    }
    beatIds.add(beat.beatId);
  }

  const actions = actionValues.map((action, index) => (
    parseResolvedModalityAction(action, index, actionValues.length)
  ));
  const actionIds = new Set<string>();
  for (const action of actions) {
    if (actionIds.has(action.actionId)) {
      throw new Error(`duplicate actionId: ${action.actionId}`);
    }
    actionIds.add(action.actionId);
    const sourceBeat = beats[action.sourceBeatIndex];
    if (!sourceBeat) {
      throw new Error(`action ${action.actionId} references missing sourceBeatIndex ${action.sourceBeatIndex}`);
    }
    if (sourceBeat.beatId !== action.sourceBeatId) {
      throw new Error(`action ${action.actionId} source beat reference is inconsistent`);
    }
  }

  return {
    schemaId: AGENT_RESOLVED_BEAT_ACTION_SCHEMA_ID,
    beats,
    actions,
  };
}

export function buildAgentResolvedBeatPlanFromEnvelope(
  envelope: AgentResolvedBeatActionEnvelope,
): AgentResolvedBeatPlan {
  return {
    beats: envelope.beats.map((beat) => ({
      beatId: beat.beatId,
      beatIndex: beat.beatIndex,
      beatCount: beat.beatCount,
      intent: beat.intent,
      deliveryPhase: beat.deliveryPhase,
      ...(beat.delayMs !== undefined ? { delayMs: beat.delayMs } : {}),
    })),
  };
}

export function buildAgentResolvedOutputText(envelope: AgentResolvedBeatActionEnvelope): string {
  return envelope.beats.map((beat) => beat.text).join('\n\n').trim();
}

export function resolveAgentBeatPlan(input: {
  turnMode: AgentResolvedTurnMode;
}): AgentResolvedBeatPlan {
  if (
    input.turnMode === 'emotional'
    || input.turnMode === 'intimate'
    || input.turnMode === 'checkin'
  ) {
    return {
      beats: [
        createBeat({
          beatIndex: 0,
          beatCount: 2,
          intent: input.turnMode === 'emotional' ? 'comfort' : input.turnMode === 'checkin' ? 'checkin' : 'reply',
          deliveryPhase: 'primary',
        }),
        createBeat({
          beatIndex: 1,
          beatCount: 2,
          intent: 'follow-up',
          deliveryPhase: 'tail',
          delayMs: 400,
        }),
      ],
    };
  }
  return {
    beats: [
      createBeat({
        beatIndex: 0,
        beatCount: 1,
        intent: resolvePrimaryBeatIntent(input.turnMode),
        deliveryPhase: 'primary',
      }),
    ],
  };
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
    resolvedBeatPlan: resolveAgentBeatPlan({
      turnMode: resolvedTurnMode,
    }),
  };
}
