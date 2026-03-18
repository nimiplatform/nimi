import type {
  DerivedInteractionProfile,
  InteractionSnapshot,
  LocalChatContextRecentTurn,
  LocalChatTurnMode,
} from './types.js';
import { resolveTurnMode } from './turn-mode-resolver.js';
import { pt, type PromptLocale } from '../prompt/prompt-locale.js';

export type FastTurnPerceptionResult = {
  turnMode: LocalChatTurnMode;
  emotionalState: {
    detected: string;
    cause: string;
    suggestedApproach: string;
  } | null;
  conversationDirective: string | null;
  intimacyCeiling: 'friendly' | 'warm' | 'intimate';
};

const CONTINUATION_RE = /继续|还记得|刚才|说好的|上次|之前那个|那件事|remember|continue|we said|earlier|last time/iu;

const EMOTION_PATTERNS: Array<{
  pattern: RegExp;
  detected: string;
  causeKey: string;
  suggestedApproach: string;
}> = [
  {
    pattern: /累|疲惫|困|撑不住|扛不住/u,
    detected: '疲惫',
    causeKey: 'fast.emotion.tired',
    suggestedApproach: 'empathize-first',
  },
  {
    pattern: /委屈|难受|心酸|想哭/u,
    detected: '委屈',
    causeKey: 'fast.emotion.hurt',
    suggestedApproach: 'empathize-first',
  },
  {
    pattern: /难过|伤心|失落|低落|孤单|孤独/u,
    detected: '难过',
    causeKey: 'fast.emotion.sad',
    suggestedApproach: 'be-supportive',
  },
  {
    pattern: /烦|焦虑|害怕|紧张|崩溃|慌/u,
    detected: '焦虑',
    causeKey: 'fast.emotion.anxious',
    suggestedApproach: 'empathize-first',
  },
  {
    pattern: /哈哈|嘿嘿|好耶|笑死|开心|兴奋/u,
    detected: '兴奋',
    causeKey: 'fast.emotion.excited',
    suggestedApproach: 'lighten-mood',
  },
];

function resolveCurrentRelationship(snapshot: InteractionSnapshot | null | undefined): InteractionSnapshot['relationshipState'] | 'new' {
  return snapshot?.relationshipState || 'new';
}

function resolveFastIntimacyCeiling(snapshot: InteractionSnapshot | null | undefined): FastTurnPerceptionResult['intimacyCeiling'] {
  const relationshipState = resolveCurrentRelationship(snapshot);
  if (relationshipState === 'intimate') return 'intimate';
  if (relationshipState === 'warm') return 'warm';
  return 'friendly';
}

function resolveEmotionalState(userText: string, locale: PromptLocale): FastTurnPerceptionResult['emotionalState'] {
  const text = String(userText || '').trim();
  for (const entry of EMOTION_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        detected: entry.detected,
        cause: pt(locale, entry.causeKey),
        suggestedApproach: entry.suggestedApproach,
      };
    }
  }
  return null;
}

function buildFastDirective(input: {
  turnMode: LocalChatTurnMode;
  emotionalState: FastTurnPerceptionResult['emotionalState'];
  userText: string;
  snapshot: InteractionSnapshot | null | undefined;
  recentTurns?: LocalChatContextRecentTurn[];
  promptLocale: PromptLocale;
}): string | null {
  const locale = input.promptLocale;
  const continuationLike = CONTINUATION_RE.test(input.userText)
    || Boolean((input.recentTurns || []).length >= 2);
  switch (input.turnMode) {
    case 'emotional':
      return pt(locale, 'fast.directive.emotional');
    case 'playful':
      return pt(locale, 'fast.directive.playful');
    case 'intimate':
      return pt(locale, 'fast.directive.intimate');
    case 'explicit-media':
      return pt(locale, 'fast.directive.explicitMedia');
    case 'explicit-voice':
      return pt(locale, 'fast.directive.explicitVoice');
    case 'checkin':
      return continuationLike
        ? pt(locale, 'fast.directive.checkinContinuation')
        : pt(locale, 'fast.directive.checkinNew');
    case 'information':
    default:
      if (input.emotionalState) {
        return pt(locale, 'fast.directive.infoEmotional');
      }
      if (continuationLike || input.snapshot?.conversationDirective) {
        return pt(locale, 'fast.directive.infoContinuation');
      }
      return null;
  }
}

export function resolveFastTurnPerception(input: {
  userText: string;
  interactionProfile: DerivedInteractionProfile;
  snapshot?: InteractionSnapshot | null;
  recentTurns?: LocalChatContextRecentTurn[];
  proactive?: boolean;
  promptLocale?: PromptLocale;
}): FastTurnPerceptionResult {
  const locale = input.promptLocale || 'en';
  const turnMode = resolveTurnMode({
    userText: input.userText,
    interactionProfile: input.interactionProfile,
    proactive: input.proactive,
  });
  const emotionalState = resolveEmotionalState(input.userText, locale);
  return {
    turnMode,
    emotionalState,
    conversationDirective: buildFastDirective({
      turnMode,
      emotionalState,
      userText: input.userText,
      snapshot: input.snapshot,
      recentTurns: input.recentTurns,
      promptLocale: locale,
    }),
    intimacyCeiling: resolveFastIntimacyCeiling(input.snapshot),
  };
}
