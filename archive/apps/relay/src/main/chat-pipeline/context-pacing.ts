import type {
  DerivedInteractionProfile,
  LocalChatReplyPacingPlan,
  LocalChatTurnMode,
} from './types.js';

const GREETING_RE =
  /^(?:hi|hello|hey|yo|你好|嗨|哈喽|在吗|早安|晚安|想你了|在不在|喂)[\s!,.?？！，。~]*$/iu;
const QUESTION_RE =
  /[?？]|为什么|怎么|如何|能不能|可不可以|是什么|什么意思|怎样|要不要/u;
const EMOTIONAL_RE = /难过|好累|很累|烦|崩溃|想哭|孤单|害怕|抱抱|安慰|委屈|想你/u;
const EXCITED_RE =
  /(?:[!！]{2,}|哈哈|hh+|lol|好耶|太好了|天啊|卧槽|真的耶|笑死)/iu;
const HIGH_EMOTION_RE = /难过|崩溃|想哭|害怕|焦虑|孤单|委屈|绝望|恐惧|暴怒/u;

type ApproachPacingHint = {
  energyOverride?: LocalChatReplyPacingPlan['energy'];
  segmentDelta: number;
};

function resolveApproachPacing(suggestedApproach?: string): ApproachPacingHint {
  if (!suggestedApproach) return { segmentDelta: 0 };
  const approach = suggestedApproach.toLowerCase();
  if (/empathize|be-supportive|comfort|安慰|共情/u.test(approach)) {
    return { energyOverride: 'low', segmentDelta: 1 };
  }
  if (/lighten|playful|humor|逗|轻松/u.test(approach)) {
    return { energyOverride: 'medium', segmentDelta: 0 };
  }
  if (/redirect|distract|转移/u.test(approach)) {
    return { energyOverride: 'low', segmentDelta: -1 };
  }
  return { segmentDelta: 0 };
}

export function derivePacingPlan(input: {
  text: string;
  interactionProfile: DerivedInteractionProfile;
  allowMultiReply: boolean;
  turnMode?: LocalChatTurnMode;
  emotionalHint?: string;
  suggestedApproach?: string;
  momentum?: 'accelerating' | 'steady' | 'cooling';
}): LocalChatReplyPacingPlan {
  const text = String(input.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const isGreeting = GREETING_RE.test(text);
  const isQuestion = QUESTION_RE.test(text);
  const isEmotional = EMOTIONAL_RE.test(text);
  const isExcited = EXCITED_RE.test(text);
  const profile = input.interactionProfile;
  const energetic = profile.expression.pacingBias === 'bursty';
  const intimate = profile.relationship.warmth === 'intimate';
  const gentle = profile.relationship.warmth === 'warm';
  const highEmotion = input.emotionalHint
    ? HIGH_EMOTION_RE.test(input.emotionalHint)
    : false;
  const approachHint = resolveApproachPacing(input.suggestedApproach);
  const momentumDelta =
    input.momentum === 'accelerating' ? 1 : input.momentum === 'cooling' ? -1 : 0;
  const totalDelta = momentumDelta + approachHint.segmentDelta;

  function applyAdjustments(
    plan: LocalChatReplyPacingPlan,
  ): LocalChatReplyPacingPlan {
    const energy = approachHint.energyOverride || plan.energy;
    if (totalDelta === 0 && energy === plan.energy) return plan;
    const adjusted = Math.max(1, Math.min(3, plan.maxSegments + totalDelta)) as
      | 1
      | 2
      | 3;
    const mode: LocalChatReplyPacingPlan['mode'] =
      adjusted === 1
        ? 'single'
        : adjusted === 2
          ? plan.mode === 'answer-followup'
            ? 'answer-followup'
            : 'burst-2'
          : 'burst-3';
    return { ...plan, maxSegments: adjusted, mode, energy };
  }

  if (input.turnMode === 'explicit-media') {
    return applyAdjustments({
      mode: 'answer-followup',
      maxSegments: 2,
      energy: 'medium',
      reason: 'explicit-media-needs-setup-and-delivery',
    });
  }
  if (input.turnMode === 'information') {
    return applyAdjustments({
      mode:
        isQuestion && input.allowMultiReply ? 'answer-followup' : 'single',
      maxSegments: isQuestion && input.allowMultiReply ? 2 : 1,
      energy: 'low',
      reason: 'information-prefers-compact',
    });
  }
  if (isEmotional || highEmotion) {
    return applyAdjustments({
      mode: 'answer-followup',
      maxSegments: highEmotion ? 3 : 2,
      energy: 'low',
      reason: highEmotion
        ? 'high-emotion-needs-extended-followup'
        : 'emotional-needs-soft-followup',
    });
  }
  if (isExcited && energetic) {
    return applyAdjustments({
      mode: 'burst-3',
      maxSegments: 3,
      energy: 'high',
      reason: 'playful-high-energy',
    });
  }
  if (isGreeting && (intimate || gentle || energetic)) {
    return applyAdjustments({
      mode: 'burst-2',
      maxSegments: 2,
      energy: gentle ? 'medium' : 'high',
      reason: 'greeting-needs-two-beats',
    });
  }
  if (intimate) {
    return applyAdjustments({
      mode: 'burst-3',
      maxSegments: 3,
      energy: 'medium',
      reason: 'intimate-scene-escalation',
    });
  }
  if (input.allowMultiReply && (gentle || energetic || isQuestion)) {
    return applyAdjustments({
      mode: isQuestion ? 'answer-followup' : 'burst-2',
      maxSegments: 2,
      energy: energetic ? 'medium' : 'low',
      reason: 'natural-delivery-style',
    });
  }
  return applyAdjustments({
    mode: 'single',
    maxSegments: 1,
    energy: energetic ? 'medium' : 'low',
    reason: 'default-single',
  });
}
