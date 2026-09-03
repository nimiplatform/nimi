import type { useTranslation } from 'react-i18next';
import type { SourceDetailData } from './source-detail-model.js';
import { personaStyleDisplayText } from './source-detail-persona-style-labels.js';
import { simplifySourceDetailChineseText as simplifyDisplayText } from './source-detail-simplified-chinese.js';
import { topicChips } from './source-detail-world-character-labels.js';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

export type WorldCharacterQuestionTopicKind = 'relationship' | 'work' | 'role' | 'faction' | 'rank' | 'scene' | 'topic';

export type WorldCharacterQuestionTopic = {
  kind: WorldCharacterQuestionTopicKind;
  text: string;
};

function cleanQuestionTopicText(value: string): string {
  return simplifyDisplayText(value).replace(/[。.!！?？]+$/u, '').trim();
}

function isReadableRelationshipQuestionTopic(value: string): boolean {
  const text = cleanQuestionTopicText(value);
  if (!text || text.length > 18) {
    return false;
  }
  if (/[XYＸＹ]/u.test(text) || /[A-Za-z]/u.test(text) || /[()（）:：]/u.test(text)) {
    return false;
  }
  return !/(所作|收到|得到|赠言|贺词|画赞|畫贊|图像|圖像|墓志|墓誌|墓表|神道碑|生祠|作序|由.+作|为.+作)/u.test(text);
}

// Work titles and topic chips arrive from realm data that may carry entity
// disambiguators (`草堂集(李白)`), romanized duplicates, or overlong labels.
// Those read as database rows, not as something a user would ask about.
function isReadableQuestionTopicText(value: string): boolean {
  const text = cleanQuestionTopicText(value);
  if (!text || text.length > 18) {
    return false;
  }
  return !/[A-Za-z()（）:：]/u.test(text);
}

// Realm Persona Studio style fields are closed-set codes that personaStyleDisplayText
// localizes, while world characters author localized free text into the same fields. A
// value that survives as a bare ASCII slug (e.g. `scene-grounded-greeting`) is an
// untranslated machine token, not display text, and must not leak into a question.
export function isReadablePersonaQuestionTopic(value: string): boolean {
  const text = value.trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) {
    return true;
  }
  if (/[-_]/u.test(text)) {
    return false;
  }
  return /[A-Z]/u.test(text);
}

function personaQuestionTopic(
  kind: WorldCharacterQuestionTopicKind,
  value: string,
  t: TranslationFn,
): WorldCharacterQuestionTopic | null {
  const text = personaStyleDisplayText(value, t);
  return isReadablePersonaQuestionTopic(text) ? { kind, text } : null;
}

function uniqueQuestionTopics(topics: WorldCharacterQuestionTopic[]): WorldCharacterQuestionTopic[] {
  const seen = new Set<string>();
  return topics
    .map((topic) => ({
      ...topic,
      text: cleanQuestionTopicText(topic.text),
    }))
    .filter((topic) => {
      if (!topic.text || seen.has(topic.text)) {
        return false;
      }
      seen.add(topic.text);
      return true;
    });
}

function worldCharacterQuestionText(
  topic: WorldCharacterQuestionTopic,
  t: TranslationFn,
): string {
  if (topic.kind === 'relationship') {
    return t('SourceDetail.worldCharacter.relationshipQuestion', {
      topic: topic.text,
      defaultValue: `How are you connected to ${topic.text}?`,
    });
  }
  if (topic.kind === 'work') {
    return t('SourceDetail.worldCharacter.workQuestion', {
      topic: topic.text,
      defaultValue: `Why does your ${topic.text} matter?`,
    });
  }
  if (topic.kind === 'role') {
    return t('SourceDetail.worldCharacter.roleQuestion', {
      topic: topic.text,
      defaultValue: `Why are you known as ${topic.text}?`,
    });
  }
  if (topic.kind === 'faction') {
    return t('SourceDetail.worldCharacter.factionQuestion', {
      topic: topic.text,
      defaultValue: `How did ${topic.text} shape your life?`,
    });
  }
  if (topic.kind === 'rank') {
    return t('SourceDetail.worldCharacter.rankQuestion', {
      topic: topic.text,
      defaultValue: `What did you experience while serving as ${topic.text}?`,
    });
  }
  if (topic.kind === 'scene') {
    return t('SourceDetail.worldCharacter.sceneQuestion', {
      topic: topic.text,
      defaultValue: `What did you experience in ${topic.text}?`,
    });
  }
  return t('SourceDetail.worldCharacter.topicQuestion', {
    topic: topic.text,
    defaultValue: `How would you explain ${topic.text}?`,
  });
}

export function buildWorldCharacterQuestions(
  source: SourceDetailData,
  t: TranslationFn,
  limit = 8,
): string[] {
  const relationshipTopics = source.relationshipClues
    .map((clue): WorldCharacterQuestionTopic | null => {
      const targetLabel = clue.targetLabel ? cleanQuestionTopicText(clue.targetLabel) : '';
      if (targetLabel && isReadableRelationshipQuestionTopic(targetLabel)) {
        return { kind: clue.type === 'status' ? 'role' : 'relationship', text: targetLabel };
      }
      const label = cleanQuestionTopicText(clue.label);
      if (!isReadableRelationshipQuestionTopic(label)) {
        return null;
      }
      return { kind: clue.type === 'status' ? 'role' : 'relationship', text: label };
    })
    .filter((topic): topic is WorldCharacterQuestionTopic => Boolean(topic));
  const questionTopics = uniqueQuestionTopics([
    source.characterProfile.role ? personaQuestionTopic('role', source.characterProfile.role, t) : null,
    source.characterProfile.archetype ? personaQuestionTopic('topic', source.characterProfile.archetype, t) : null,
    ...source.characterProfile.traits.map((trait) => personaQuestionTopic('topic', trait, t)),
    ...source.characterProfile.interactionModes.map((mode) => personaQuestionTopic('topic', mode, t)),
    ...source.works
      .filter((work) => !work.textClue)
      .map((work) => work.title)
      .filter(isReadableQuestionTopicText)
      .map((title) => ({ kind: 'work' as const, text: title })),
    ...relationshipTopics,
    ...topicChips(source, t)
      .filter((topic) => isReadablePersonaQuestionTopic(topic) && isReadableQuestionTopicText(topic))
      .map((topic) => ({ kind: 'topic' as const, text: topic })),
  ].filter((topic): topic is WorldCharacterQuestionTopic => Boolean(topic)));
  return questionTopics
    .map((topic) => worldCharacterQuestionText(topic, t))
    .slice(0, limit);
}
