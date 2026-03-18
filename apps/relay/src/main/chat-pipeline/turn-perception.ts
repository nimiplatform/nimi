// Relay turn perception — adapted from local-chat turn-perception.ts
// Removed: mod SDK imports, describeLocalChatGenerateObjectFailure
// Adapted: console.log/error for main process logging, local types

import type {
  InteractionSnapshot,
  LocalChatTurnAiClient,
  LocalChatTurnMode,
  RelationMemorySlot,
} from './types.js';
import type { TurnInvokeInput } from './request-builder.js';
import { pt, type PromptLocale } from '../prompt/prompt-locale.js';
import { buildPerceptionCompactContext } from './perception-context.js';

export type TurnPerceptionResult = {
  turnMode: LocalChatTurnMode;
  emotionalState: {
    detected: string;
    cause: string;
    suggestedApproach: string;
  } | null;
  relevantMemoryIds: string[];
  conversationDirective: string | null;
  intimacyCeiling: 'friendly' | 'warm' | 'intimate';
};

function getPerceptionPromptTemplate(locale: PromptLocale): string {
  return pt(locale, 'perception.template');
}

function parseIntimacyCeiling(
  value: unknown,
  fallback: 'friendly' | 'warm' | 'intimate',
): TurnPerceptionResult['intimacyCeiling'] {
  const str = String(value || '').trim().toLowerCase();
  if (str === 'friendly' || str === 'warm' || str === 'intimate') return str;
  return fallback;
}

function parsePerceptionResult(
  object: Record<string, unknown>,
  currentRelationship?: string,
): TurnPerceptionResult {
  const turnMode = parseTurnMode(object.turnMode);
  const emotionalState = parseEmotionalState(object.emotionalState);
  const relevantMemoryIds = parseStringArray(object.relevantMemoryIds);
  const conversationDirective =
    typeof object.conversationDirective === 'string'
      ? object.conversationDirective.trim() || null
      : null;
  const defaultCeiling: TurnPerceptionResult['intimacyCeiling'] =
    currentRelationship === 'intimate'
      ? 'intimate'
      : currentRelationship === 'warm'
        ? 'warm'
        : 'friendly';
  const intimacyCeiling = parseIntimacyCeiling(object.intimacyCeiling, defaultCeiling);
  return { turnMode, emotionalState, relevantMemoryIds, conversationDirective, intimacyCeiling };
}

function parseTurnMode(value: unknown): LocalChatTurnMode {
  const str = String(value || '').trim().toLowerCase();
  const valid: LocalChatTurnMode[] = [
    'information',
    'emotional',
    'playful',
    'intimate',
    'checkin',
    'explicit-media',
    'explicit-voice',
  ];
  return valid.includes(str as LocalChatTurnMode) ? (str as LocalChatTurnMode) : 'information';
}

function parseEmotionalState(value: unknown): TurnPerceptionResult['emotionalState'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const detected = String(record.detected || '').trim();
  if (!detected) return null;
  return {
    detected,
    cause: String(record.cause || '').trim(),
    suggestedApproach: String(record.suggestedApproach || '').trim(),
  };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

/**
 * Hardcoded overrides that don't need AI — instant return for unambiguous cases.
 * Returns null if AI perception is needed.
 */
function tryHardcodedOverride(input: {
  userText: string;
  proactive?: boolean;
}): LocalChatTurnMode | null {
  if (input.proactive) return 'checkin';
  const text = input.userText.trim();
  if (/^(发图|来张图|发一张|给我看看你|发个视频|来个视频)\b/u.test(text)) return 'explicit-media';
  if (/^(用语音|语音回复|读给我听)\b/u.test(text)) return 'explicit-voice';
  return null;
}

export async function perceiveTurn(input: {
  aiClient: LocalChatTurnAiClient;
  invokeInput: TurnInvokeInput;
  userText: string;
  snapshot: InteractionSnapshot | null;
  memorySlots: RelationMemorySlot[];
  recentTurns?: Array<{ role: string; text: string }>;
  proactive?: boolean;
  regexFallbackTurnMode?: LocalChatTurnMode;
  promptLocale?: PromptLocale;
}): Promise<TurnPerceptionResult> {
  const currentRelationship = input.snapshot?.relationshipState || 'new';
  const defaultCeiling: TurnPerceptionResult['intimacyCeiling'] =
    currentRelationship === 'intimate'
      ? 'intimate'
      : currentRelationship === 'warm'
        ? 'warm'
        : 'friendly';

  // Fast path: unambiguous cases don't need AI
  const hardcoded = tryHardcodedOverride({
    userText: input.userText,
    proactive: input.proactive,
  });
  if (hardcoded) {
    return {
      turnMode: hardcoded,
      emotionalState: null,
      relevantMemoryIds: [],
      conversationDirective: null,
      intimacyCeiling: defaultCeiling,
    };
  }

  const promptLocale = input.promptLocale || 'en';
  const promptTemplate = getPerceptionPromptTemplate(promptLocale);
  const compactContext = buildPerceptionCompactContext({
    userText: input.userText,
    snapshot: input.snapshot,
    memorySlots: input.memorySlots,
    recentTurns: (input.recentTurns || []).slice(-5),
    promptLocale,
    template: promptTemplate,
  });
  const prompt = promptTemplate
    .replace('{userText}', compactContext.promptParts.userText)
    .replace('{recentTurnsContext}', compactContext.promptParts.recentTurnsContext)
    .replace('{snapshotContext}', compactContext.promptParts.snapshotContext)
    .replace('{memoryContext}', compactContext.promptParts.memoryContext);

  try {
    console.log('[relay:turn-perception] generateObject: calling...', {
      userTextChars: compactContext.trace.userTextChars,
      recentTurnsCount: (input.recentTurns || []).length,
      memorySlotsCount: (input.memorySlots || []).length,
      promptChars: compactContext.trace.promptChars,
      compactionApplied: compactContext.trace.compactionApplied,
      maxTokens: 1024,
      temperature: 0.3,
    });
    const result = await input.aiClient.generateObject({
      ...input.invokeInput,
      debugLabel: 'turn-perception',
      prompt,
      maxTokens: 1024,
      temperature: 0.3,
    });
    const parsed = parsePerceptionResult(result.object as Record<string, unknown>, currentRelationship);
    console.log('[relay:turn-perception] generateObject: success', {
      turnMode: parsed.turnMode,
      emotionalState: parsed.emotionalState?.detected || null,
      intimacyCeiling: parsed.intimacyCeiling,
      traceId: result.traceId || null,
    });
    return parsed;
  } catch (err) {
    console.error('[relay:turn-perception] generateObject: FAILED', {
      error: err instanceof Error ? err.message : String(err),
      fallback: input.regexFallbackTurnMode || 'information',
    });
    // Fallback: use regex-based turnMode instead of hardcoded 'information'
    return {
      turnMode: input.regexFallbackTurnMode || 'information',
      emotionalState: null,
      relevantMemoryIds: [],
      conversationDirective: null,
      intimacyCeiling: defaultCeiling,
    };
  }
}
