import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AuthStatus } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import type { SourceDetailData } from '../source-detail/source-detail-model.js';
import {
  fetchSourceDisplayDetail,
  sourceDisplayDetailQueryKey,
} from '../source-detail/source-detail-queries.js';
import { buildWorldCharacterQuestions, isReadablePersonaQuestionTopic } from '../source-detail/source-detail-world-character-questions.js';
import { simplifySourceDetailChineseText as simplifyDisplayText } from '../source-detail/source-detail-simplified-chinese.js';
import { worldCharacterHeroSubtitle } from '../source-detail/source-detail-world-character-labels.js';
import { personaStyleDisplayText } from '../source-detail/source-detail-persona-style-labels.js';

export const AGENT_EMPTY_STATE_CHARACTER_QUESTION_LIMIT = 2;

export type AgentEmptyStateCharacterPresence = {
  questions: readonly string[];
  greeting: string | null;
  heroSubtitle: string | null;
  referenceImageUrl: string | null;
  voiceSampleUrl: string | null;
  voiceSampleDurationSec: number | null;
};

type TranslationFn = ReturnType<typeof useTranslation>['t'];

// Presence content for the agent chat empty state, derived from the same Realm
// source detail that backs the profile page (suggested questions, the
// character's opening line, portrait, and voice sample). Returns null when the
// source carries no usable presence, so the caller falls back to the generic
// empty state.
export function toAgentEmptyStateCharacterPresence(
  source: SourceDetailData,
  t: TranslationFn,
  questionLimit = AGENT_EMPTY_STATE_CHARACTER_QUESTION_LIMIT,
): AgentEmptyStateCharacterPresence | null {
  if (source.sourceKind !== 'worldCharacter') {
    return null;
  }
  const questions = buildWorldCharacterQuestions(source, t, questionLimit);
  const greetingText = source.characterProfile.interaction?.greeting;
  const greeting = greetingText ? simplifyDisplayText(greetingText) || null : null;
  const baseSubtitle = worldCharacterHeroSubtitle(source);
  const roleText = source.characterProfile.role
    ? personaStyleDisplayText(source.characterProfile.role, t)
    : '';
  const roleSubtitle = roleText && isReadablePersonaQuestionTopic(roleText) ? simplifyDisplayText(roleText) : '';
  const heroSubtitle = [baseSubtitle, roleSubtitle && !baseSubtitle?.includes(roleSubtitle) ? roleSubtitle : '']
    .filter(Boolean)
    .join(' · ') || null;
  const referenceImageUrl = source.referenceImageUrl || null;
  const voiceSampleUrl = source.voiceSample?.url || null;
  const voiceSampleDurationSec = source.voiceSample?.durationSec ?? null;
  if (questions.length === 0 && !greeting && !referenceImageUrl && !voiceSampleUrl) {
    return null;
  }
  return { questions, greeting, heroSubtitle, referenceImageUrl, voiceSampleUrl, voiceSampleDurationSec };
}

export function useAgentEmptyStateCharacterPresence(input: {
  sourceRef: CharacterSourceRefV3 | null;
  authStatus: AuthStatus;
}): AgentEmptyStateCharacterPresence | null {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const sourceRef = input.sourceRef;
  const detailQuery = useQuery({
    queryKey: sourceRef
      ? sourceDisplayDetailQueryKey(sourceRef)
      : ['source-display-detail', 'missing-character-source-ref-v3'],
    queryFn: async () => (sourceRef ? fetchSourceDisplayDetail(sourceRef, bindings.sdk) : null),
    enabled: input.authStatus === 'authenticated' && Boolean(sourceRef),
  });
  const source = detailQuery.data?.source ?? null;
  return useMemo(
    () => (source ? toAgentEmptyStateCharacterPresence(source, t) : null),
    [source, t],
  );
}
