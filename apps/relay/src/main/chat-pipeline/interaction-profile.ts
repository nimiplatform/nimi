import type {
  DerivedInteractionProfile,
  LocalChatReplyStyleProfile,
  LocalChatTarget,
} from './types.js';
import { asRecord, type JsonObject } from '../../shared/json.js';

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNestedRecord(record: unknown, path: string[]): JsonObject {
  let current = asRecord(record);
  for (const key of path) {
    current = asRecord(current[key]);
  }
  return current;
}

function normalizeResponseLength(value: unknown): LocalChatReplyStyleProfile['responseLength'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'short' || normalized === 'long') return normalized;
  return 'medium';
}

function normalizeFormality(value: unknown): LocalChatReplyStyleProfile['formality'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'formal' || normalized === 'slang') return normalized;
  return 'casual';
}

function normalizeSentiment(value: unknown): LocalChatReplyStyleProfile['sentiment'] {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'positive' || normalized === 'cynical') return normalized;
  return 'neutral';
}

function detectLanguage(target: LocalChatTarget): string | null {
  const metadata = asRecord(target.metadata);
  const dna = asRecord(target.dna);
  const dnaVoice = readNestedRecord(dna, ['voice'] as string[]);
  const candidates = [
    metadata.language,
    metadata.locale,
    dnaVoice.language,
  ].map((value) => asString(value).toLowerCase()).filter(Boolean);
  const value = candidates[0] || '';
  if (!value) return null;
  if (value.startsWith('zh')) return 'zh';
  if (value.startsWith('ja')) return 'ja';
  if (value.startsWith('ko')) return 'ko';
  if (value.startsWith('en')) return 'en';
  return value;
}

function inferGenderGuard(value: unknown): DerivedInteractionProfile['voice']['genderGuard'] {
  const normalized = asString(value).toLowerCase();
  if (/male|man|boy|男性|男/u.test(normalized)) return 'male';
  if (/female|woman|girl|女性|女/u.test(normalized)) return 'female';
  if (normalized) return 'neutral';
  return 'unspecified';
}

export function deriveInteractionProfile(target: LocalChatTarget): DerivedInteractionProfile {
  const metadata = asRecord(target.metadata);
  const dna = asRecord(target.dna);
  const dnaIdentity = readNestedRecord(dna, ['identity'] as string[]);
  const dnaBiological = readNestedRecord(dna, ['biological'] as string[]);
  const dnaAppearance = readNestedRecord(dna, ['appearance'] as string[]);
  const dnaPersonality = readNestedRecord(dna, ['personality'] as string[]);
  const dnaCommunication = readNestedRecord(dna, ['communication'] as string[]);
  const dnaVoice = readNestedRecord(dna, ['voice'] as string[]);
  const dnaSecondary = [
    ...asArray(metadata.dnaSecondary),
  ].map((item) => asString(item).toUpperCase()).filter(Boolean);
  const relationshipMode = asString(dnaPersonality.relationshipMode || metadata.relationshipMode) || 'friendly';
  const responseLength = normalizeResponseLength(dnaCommunication.responseLength || metadata.responseLength);
  const formality = normalizeFormality(dnaCommunication.formality || metadata.formality);
  const sentiment = normalizeSentiment(dnaCommunication.sentiment || metadata.sentiment);
  const warmRelationship = /(friendly|gentle|warm|supportive|陪伴|温柔|朋友|治愈)/u.test(relationshipMode);
  const intimateRelationship = /(romantic|intimate|flirty|lover|partner|close|亲密|暧昧|恋人|伴侣)/u.test(relationshipMode);
  const playfulSignal = dnaSecondary.includes('PLAYFUL') || dnaSecondary.includes('CHAOTIC') || dnaSecondary.includes('BOLD');
  const reservedSignal = formality === 'formal' || sentiment === 'cynical' || dnaSecondary.includes('TSUNDERE');
  const artStyle = asString(dnaAppearance.artStyle || metadata.artStyle);
  const fashionStyle = asString(dnaAppearance.fashionStyle || metadata.fashionStyle);
  const personaCue = asString(dnaPersonality.summary || dnaIdentity.summary || metadata.persona);
  const voiceId = asString(dnaVoice.voiceId || metadata.voiceName) || null;
  const nsfwLevel = asString(dna.nsfwLevel || metadata.nsfwLevel) || null;

  return {
    expression: {
      responseLength,
      formality,
      sentiment,
      pacingBias: reservedSignal ? 'reserved' : playfulSignal ? 'bursty' : 'balanced',
      firstBeatStyle: intimateRelationship
        ? 'intimate'
        : playfulSignal
          ? 'playful'
          : warmRelationship
            ? 'gentle'
            : reservedSignal
              ? 'grounded'
              : 'direct',
      infoAnswerStyle: responseLength === 'short'
        ? 'concise'
        : reservedSignal
          ? 'guided'
          : 'balanced',
      emojiUsage: playfulSignal || intimateRelationship ? 'frequent'
        : reservedSignal ? 'none'
        : 'occasional',
    },
    relationship: {
      defaultDistance: intimateRelationship
        ? 'intimate'
        : warmRelationship
          ? 'warm'
          : formality === 'formal'
            ? 'formal'
            : 'friendly',
      warmth: intimateRelationship ? 'intimate' : warmRelationship ? 'warm' : sentiment === 'cynical' ? 'cool' : 'warm',
      flirtAffinity: intimateRelationship ? 'high' : warmRelationship ? 'light' : 'none',
      proactiveStyle: playfulSignal ? 'playful' : warmRelationship ? 'gentle' : 'quiet',
      intimacyGuard: intimateRelationship ? 'open' : warmRelationship ? 'balanced' : 'strict',
    },
    voice: {
      voiceId,
      language: detectLanguage(target),
      genderGuard: inferGenderGuard(dnaBiological.gender || dnaVoice.gender || metadata.gender),
      speedRange: playfulSignal ? 'fast' : reservedSignal ? 'slow' : 'balanced',
      pitchRange: intimateRelationship ? 'bright' : reservedSignal ? 'low' : 'mid',
      emotionEnabled: dnaVoice.emotionEnabled !== false,
      voiceAffinity: voiceId || warmRelationship || intimateRelationship ? 'high' : playfulSignal ? 'medium' : 'low',
    },
    visual: {
      artStyle: artStyle || null,
      fashionStyle: fashionStyle || null,
      personaCue: personaCue || null,
      nsfwLevel,
      imageAffinity: artStyle || fashionStyle || warmRelationship ? 'high' : 'medium',
      videoAffinity: playfulSignal || intimateRelationship ? 'medium' : 'low',
    },
    modalityTraits: {
      textBias: reservedSignal ? 'high' : 'medium',
      voiceBias: warmRelationship || intimateRelationship ? 'high' : playfulSignal ? 'medium' : 'low',
      imageBias: artStyle || personaCue ? 'medium' : 'low',
      videoBias: playfulSignal ? 'medium' : 'low',
      latencyTolerance: intimateRelationship || warmRelationship ? 'medium' : 'low',
    },
    signals: [
      relationshipMode ? `relationship:${relationshipMode}` : '',
      responseLength ? `response:${responseLength}` : '',
      formality ? `formality:${formality}` : '',
      sentiment ? `sentiment:${sentiment}` : '',
      artStyle ? `artStyle:${artStyle}` : '',
      nsfwLevel ? `nsfw:${nsfwLevel}` : '',
    ].filter(Boolean),
  };
}

export function toLegacyReplyStyleProfile(profile: DerivedInteractionProfile): LocalChatReplyStyleProfile {
  const relationshipMode: LocalChatReplyStyleProfile['relationshipMode'] = (
    profile.relationship.flirtAffinity === 'high'
    || profile.relationship.defaultDistance === 'intimate'
  )
    ? 'romantic'
    : profile.relationship.defaultDistance;
  return {
    responseLength: profile.expression.responseLength,
    formality: profile.expression.formality,
    sentiment: profile.expression.sentiment,
    relationshipMode,
    pacingStyle: profile.expression.pacingBias,
    followupStyle: relationshipMode === 'romantic'
      || profile.relationship.warmth === 'warm'
      ? 'eager'
      : profile.expression.pacingBias === 'reserved'
        ? 'rare'
        : 'situational',
    warmth: profile.relationship.warmth,
    signals: [...profile.signals],
  };
}
