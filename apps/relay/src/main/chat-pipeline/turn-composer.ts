// Relay turn composer — adapted from local-chat turn-composer.ts
// Removed: mod SDK imports (logRendererEvent, describeLocalChatGenerateObjectFailure)
// Adapted: local types for relay main process

import type {
  InteractionBeat,
  InteractionBeatMediaRequest,
  InteractionTurnPlan,
  LocalChatContextPacket,
  LocalChatTurnAiClient,
  LocalChatTurnMode,
} from './types.js';
import type { TurnInvokeInput } from './request-builder.js';
import { createUlid } from './ulid.js';
import { stripTrailingEndMarkerFragment } from './stream-end-marker.js';
import { pt, type PromptLocale } from '../prompt/prompt-locale.js';

type ComposerBeatObject = {
  mediaRequest?: Pick<InteractionBeatMediaRequest, 'kind' | 'prompt'>;
  content?: string;
  intent?: InteractionBeat['intent'] | string;
  pauseMs?: number | string;
  pause_ms?: number | string;
  relationMove?: string;
  relation_move?: string;
  sceneMove?: string;
  scene_move?: string;
  text?: string;
};

type ComposerPlanObject = {
  beats?: ComposerBeatObject[];
};

function asString(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asBeatText(value: unknown): string {
  return stripTrailingEndMarkerFragment(asString(value));
}

function normalizeBeatIntent(value: unknown): InteractionBeat['intent'] {
  const normalized = asString(value).toLowerCase();
  if (
    normalized === 'clarify'
    || normalized === 'checkin'
    || normalized === 'comfort'
    || normalized === 'tease'
    || normalized === 'invite'
    || normalized === 'media'
  ) {
    return normalized;
  }
  return 'answer';
}

function normalizePauseMs(value: unknown, index: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return index === 0 ? 650 : 600;
  return Math.max(180, Math.min(2400, Math.round(numeric)));
}

function clampBeatCount(turnMode: LocalChatTurnMode): number {
  if (turnMode === 'information') return 2;
  if (turnMode === 'checkin') return 2;
  return 4;
}

const DEFAULT_COMPOSER_MAX_TOKENS = 1200;
const EXPLICIT_MEDIA_COMPOSER_MAX_TOKENS = 1800;
const EXPLICIT_MEDIA_COMPOSER_LENGTH_RETRY_MAX_TOKENS = 2400;

function resolveComposerMaxTokens(input: {
  turnMode: LocalChatTurnMode;
  lastFailureFinishReason: string | null;
}): number {
  if (input.turnMode !== 'explicit-media') return DEFAULT_COMPOSER_MAX_TOKENS;
  if (input.lastFailureFinishReason === 'length') {
    return EXPLICIT_MEDIA_COMPOSER_LENGTH_RETRY_MAX_TOKENS;
  }
  return EXPLICIT_MEDIA_COMPOSER_MAX_TOKENS;
}

function toBigrams(text: string): Set<string> {
  const chars = text.replace(/\s+/g, '');
  const bigrams = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.add(chars.slice(i, i + 2));
  }
  return bigrams;
}

function bigramOverlap(a: string, b: string): number {
  const bigramsA = toBigrams(a);
  const bigramsB = toBigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }
  const union = new Set([...bigramsA, ...bigramsB]).size;
  return union === 0 ? 0 : intersection / union;
}

function isSemanticallyDuplicate(a: string, b: string): boolean {
  return bigramOverlap(a, b) > 0.6;
}

function isCrossTurnDuplicate(text: string, recentBeatTexts: string[]): boolean {
  const normalized = asString(text);
  if (!normalized || recentBeatTexts.length === 0) return false;
  return recentBeatTexts.some((candidate) => {
    const previous = asString(candidate);
    if (!previous) return false;
    if (normalized === previous) return true;
    if (normalized.length < 8 || previous.length < 8) {
      return bigramOverlap(normalized, previous) > 0.82;
    }
    return bigramOverlap(normalized, previous) > 0.7;
  });
}

const INTIMACY_RANK: Record<string, number> = {
  friendly: 1,
  warm: 2,
  intimate: 3,
};

const INTIMATE_RELATION_MOVE_RE =
  /intimate|kiss|hug|closer|暧昧|亲密|依赖|撒娇|表白/u;
const WARM_RELATION_MOVE_RE = /warm|comfort|陪伴|温柔|抱抱/u;

function clampRelationMove(relationMove: string, intimacyCeiling?: string): string {
  if (!intimacyCeiling) return relationMove;
  const ceilingRank = INTIMACY_RANK[intimacyCeiling] || 1;
  if (INTIMATE_RELATION_MOVE_RE.test(relationMove) && ceilingRank < 3) {
    return ceilingRank >= 2 ? 'warm' : 'friendly';
  }
  if (WARM_RELATION_MOVE_RE.test(relationMove) && ceilingRank < 2) {
    return 'friendly';
  }
  return relationMove;
}

function parsePlanObject(input: {
  object: ComposerPlanObject;
  turnId: string;
  turnMode: LocalChatTurnMode;
  intimacyCeiling?: string;
  recentBeatTexts?: string[];
  sealedFirstBeatText: string;
}): InteractionTurnPlan {
  const planId = `plan_${createUlid()}`;
  const rawBeats = Array.isArray(input.object.beats) ? input.object.beats : [];
  const beats: InteractionBeat[] = [];
  rawBeats.slice(0, clampBeatCount(input.turnMode)).forEach((item, index, list) => {
    const text = asBeatText(item.text || item.content);
    if (!text) return;
    if (isSemanticallyDuplicate(text, input.sealedFirstBeatText)) return;
    const kind = asString(item.mediaRequest?.kind);
    const prompt = asBeatText(item.mediaRequest?.prompt);
    const rawRelationMove = asString(
      item.relationMove || item.relation_move || input.turnMode,
    );
    const allowMediaRequest = input.turnMode === 'explicit-media';
    beats.push({
      beatId: `beat_${createUlid()}`,
      turnId: input.turnId,
      beatIndex: index + 1,
      beatCount: list.length || 1,
      intent: normalizeBeatIntent(item.intent),
      relationMove: clampRelationMove(rawRelationMove, input.intimacyCeiling),
      sceneMove: asString(item.sceneMove || item.scene_move || input.turnMode),
      modality: 'text',
      text,
      pauseMs: normalizePauseMs(item.pauseMs || item.pause_ms, index),
      mediaRequest:
        allowMediaRequest && (kind === 'image' || kind === 'video')
          ? {
              kind,
              prompt: prompt || text,
              confidence: 0.74,
              nsfwIntent: /nsfw|暧昧|亲密|裸|吻/u.test(prompt || text) ? 'suggested' : 'none',
            }
          : undefined,
      cancellationScope: 'tail',
    });
  });

  // Semantic dedup: skip beats too similar to already accepted ones
  const dedupedBeats: InteractionBeat[] = [];
  const recentBeatTexts = (input.recentBeatTexts || []).map((value) => asString(value)).filter(Boolean);
  for (const beat of beats) {
    const isDuplicate = dedupedBeats.some((accepted) =>
      isSemanticallyDuplicate(beat.text, accepted.text),
    );
    const isRepeatedFromRecentTurn = isCrossTurnDuplicate(beat.text, recentBeatTexts);
    if (!isDuplicate && !isRepeatedFromRecentTurn) {
      dedupedBeats.push(beat);
    }
  }

  // Tail beat pruning: remove low-information-gain trailing beat
  if (dedupedBeats.length > 1) {
    const lastBeat = dedupedBeats[dedupedBeats.length - 1]!;
    const prevBeat = dedupedBeats[dedupedBeats.length - 2]!;
    const isLowGain = bigramOverlap(lastBeat.text, prevBeat.text) > 0.4;
    const isInviteOrOpen =
      /[?？…]/.test(lastBeat.text)
      || lastBeat.intent === 'comfort'
      || lastBeat.intent === 'invite'
      || lastBeat.intent === 'media';
    if (isLowGain && !isInviteOrOpen) {
      dedupedBeats.pop();
    }
  }

  const normalizedBeats =
    dedupedBeats.length > 0
      ? dedupedBeats.map((beat, index) => ({
          ...beat,
          beatIndex: index + 1,
          beatCount: dedupedBeats.length + 1,
        }))
      : [];

  return {
    planId,
    turnId: input.turnId,
    turnMode: input.turnMode,
    beats: normalizedBeats,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
}

export async function composeInteractionTurnPlan(input: {
  aiClient: LocalChatTurnAiClient;
  invokeInput: TurnInvokeInput;
  contextPacket: LocalChatContextPacket;
  userText: string;
  turnId: string;
  turnMode: LocalChatTurnMode;
  deliveryStyle?: 'natural' | 'compact';
  emotionalState?: string;
  directive?: string;
  intimacyCeiling?: string;
  recentBeatTexts?: string[];
  sealedFirstBeatText: string;
}): Promise<InteractionTurnPlan> {
  const perceptionLines: string[] = [];
  if (input.emotionalState) {
    perceptionLines.push(`emotionalState=${input.emotionalState}`);
  }
  if (input.directive) {
    perceptionLines.push(`directive=${input.directive}`);
  }
  if (input.intimacyCeiling) {
    perceptionLines.push(`intimacyCeiling=${input.intimacyCeiling}`);
  }
  const locale: PromptLocale = input.contextPacket.promptLocale || 'en';
  if (input.recentBeatTexts && input.recentBeatTexts.length > 0) {
    perceptionLines.push('');
    perceptionLines.push(pt(locale, 'composer.recentNoDup'));
    perceptionLines.push(input.recentBeatTexts.join(' | '));
  }

  const isExplicitMedia = input.turnMode === 'explicit-media';
  const jsonSchemaExample = isExplicitMedia
    ? '{"beats":[{"text":"...","intent":"media","relationMove":"friendly","sceneMove":"daily","pauseMs":650,"mediaRequest":{"kind":"image","prompt":"visual description"}}]}'
    : '{"beats":[{"text":"...","intent":"answer","relationMove":"friendly","sceneMove":"daily","pauseMs":650}]}';
  const composerExample = isExplicitMedia
    ? '{"beats":[{"text":"正在为你画一幅主广场的全景。","intent":"media","relationMove":"friendly","sceneMove":"daily","pauseMs":650,"mediaRequest":{"kind":"image","prompt":"a panoramic view of the main plaza with fountains and trees"}}]}'
    : '{"beats":[{"text":"先别一个人硬撑，把最压你的那件事丢给我。","intent":"invite","relationMove":"warm","sceneMove":"deeper","pauseMs":750}]}';

  const prompt = [
    input.invokeInput.prompt,
    '',
    pt(locale, 'composer.planInstruction'),
    '',
    pt(locale, 'composer.jsonFormat'),
    '```json',
    jsonSchemaExample,
    '```',
    '',
    pt(locale, 'composer.fieldExplain'),
    pt(locale, 'composer.fieldText'),
    pt(locale, 'composer.fieldIntent'),
    pt(locale, 'composer.fieldRelation'),
    pt(locale, 'composer.fieldScene'),
    pt(locale, 'composer.fieldPause'),
    pt(locale, 'composer.fieldMediaRequest'),
    '',
    pt(locale, 'composer.rulesHeader'),
    pt(locale, 'composer.ruleCount'),
    pt(locale, 'composer.ruleInfoEmpty'),
    pt(locale, 'composer.ruleTailOnly'),
    pt(locale, 'composer.ruleNewInfo'),
    pt(locale, 'composer.ruleNoMedia'),
    pt(locale, 'composer.ruleNoMarkdown'),
    pt(locale, 'composer.ruleJsonOnly'),
    '',
    pt(locale, 'composer.sealedFirstBeat', { text: input.sealedFirstBeatText }),
    '',
    pt(locale, 'composer.exampleHeader'),
    composerExample,
    '',
    `turnMode=${input.turnMode}`,
    `deliveryStyle=${input.deliveryStyle || 'natural'}`,
    `voiceConversationMode=${input.contextPacket.voiceConversationMode || 'off'}`,
    `userText=${input.userText}`,
    ...perceptionLines,
  ].join('\n');

  const TURN_COMPOSER_MAX_ATTEMPTS = 2;
  let lastFailureFinishReason: string | null = null;

  for (let attempt = 1; attempt <= TURN_COMPOSER_MAX_ATTEMPTS; attempt++) {
    const retryReminder =
      attempt === 1
        ? ''
        : '\n\n'
          + pt(
              locale,
              lastFailureFinishReason === 'length'
                ? 'composer.retryReminderLength'
                : 'composer.retryReminder',
            );
    const recentBeatCount = Array.isArray(input.recentBeatTexts)
      ? input.recentBeatTexts.length
      : 0;
    try {
      const maxTokens = resolveComposerMaxTokens({
        turnMode: input.turnMode,
        lastFailureFinishReason,
      });
      const temperature = attempt === 1 ? 0.5 : 0.3;
      const result = await input.aiClient.generateObject<ComposerPlanObject>({
        ...input.invokeInput,
        debugLabel: 'turn-composer',
        prompt: prompt + retryReminder,
        maxTokens,
        temperature,
      });
      const rawBeats = result.object.beats;
      const plan = parsePlanObject({
        object: result.object,
        turnId: input.turnId,
        turnMode: input.turnMode,
        intimacyCeiling: input.intimacyCeiling,
        recentBeatTexts: input.recentBeatTexts,
        sealedFirstBeatText: input.sealedFirstBeatText,
      });
      if (plan.beats.length > 0) {
        return plan;
      }
      break; // Parsed OK but no valid beats — retrying won't help
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Extract finishReason if it's embedded in the error
      const finishReasonMatch = errorMessage.match(/finishReason[=:]\s*(\w+)/);
      const finishReason = finishReasonMatch?.[1] || null;
      lastFailureFinishReason = finishReason;
      if (attempt >= TURN_COMPOSER_MAX_ATTEMPTS) break;
    }
  }

  return {
    planId: `plan_${createUlid()}`,
    turnId: input.turnId,
    turnMode: input.turnMode,
    beats: [],
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
}
