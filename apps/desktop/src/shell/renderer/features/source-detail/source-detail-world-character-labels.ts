import type { useTranslation } from 'react-i18next';
import type { describeCharacterPrimaryAction } from '../explore/character-source-materialization';
import type { SourceDetailData } from './source-detail-model.js';
import { simplifySourceDetailChineseText as simplifyDisplayText } from './source-detail-simplified-chinese.js';

type TranslationFn = ReturnType<typeof useTranslation>['t'];

const SCENE_REF_LABELS: Record<string, string> = {
  'yuan-literati-network': '元代文人网络',
  'yuan-academy-gathering': '元代书院雅集',
  'yuan-official-court': '元代朝廷官场',
  'ming-literati-network': '明代文人网络',
  'ming-official-career': '明代仕宦履历',
  'ming-kinship-clan': '明代宗族亲缘',
};

const SCENE_DYNASTY_LABELS: Record<string, string> = {
  qin: '秦代',
  han: '汉代',
  sui: '隋代',
  tang: '唐代',
  song: '宋代',
  liao: '辽代',
  jin: '金代',
  yuan: '元代',
  ming: '明代',
  qing: '清代',
};

const SCENE_KIND_LABELS: Record<string, string> = {
  'literati-network': '文人网络',
  'academy-gathering': '书院雅集',
  'official-court': '朝廷官场',
  'official-career': '仕宦履历',
  'kinship-clan': '宗族亲缘',
};

export function sceneRefLabel(sceneRef: string): string {
  const normalized = simplifyDisplayText(sceneRef.trim());
  const direct = SCENE_REF_LABELS[normalized];
  if (direct) {
    return direct;
  }
  const [dynastyKey, ...kindParts] = normalized.split('-').filter(Boolean);
  const dynastyLabel = dynastyKey ? SCENE_DYNASTY_LABELS[dynastyKey] : null;
  const kindLabel = SCENE_KIND_LABELS[kindParts.join('-')];
  if (dynastyLabel && kindLabel) {
    return `${dynastyLabel}${kindLabel}`;
  }
  return normalized;
}

function normalizeDynastyText(value: string): string | null {
  const normalized = simplifyDisplayText(value.trim());
  if (!normalized) {
    return null;
  }
  const exactLabels = ['秦代', '汉代', '隋代', '唐代', '宋代', '辽代', '金代', '元代', '明代', '清代'];
  for (const label of exactLabels) {
    if (normalized.includes(label)) {
      return label;
    }
  }
  const dynastyAliases: readonly [RegExp, string][] = [
    [/(?:秦朝|qin(?:[-_\s]?dynasty)?)/iu, '秦代'],
    [/(?:汉朝|漢朝|han(?:[-_\s]?dynasty)?)/iu, '汉代'],
    [/(?:隋朝|sui(?:[-_\s]?dynasty)?)/iu, '隋代'],
    [/(?:唐朝|tang(?:[-_\s]?dynasty)?)/iu, '唐代'],
    [/(?:宋朝|song(?:[-_\s]?dynasty)?)/iu, '宋代'],
    [/(?:辽朝|遼朝|liao(?:[-_\s]?dynasty)?)/iu, '辽代'],
    [/(?:金朝|jin(?:[-_\s]?dynasty)?)/iu, '金代'],
    [/(?:元朝|yuan(?:[-_\s]?dynasty)?)/iu, '元代'],
    [/(?:明朝|ming(?:[-_\s]?dynasty)?)/iu, '明代'],
    [/(?:清朝|qing(?:[-_\s]?dynasty)?)/iu, '清代'],
  ];
  for (const [pattern, label] of dynastyAliases) {
    if (pattern.test(normalized)) {
      return label;
    }
  }
  return null;
}

function sceneDynastyLabel(sceneRef: string): string | null {
  const normalized = simplifyDisplayText(sceneRef.trim());
  const direct = SCENE_REF_LABELS[normalized];
  const directDynasty = direct ? normalizeDynastyText(direct) : null;
  if (directDynasty) {
    return directDynasty;
  }
  const [dynastyKey] = normalized.split('-').filter(Boolean);
  if (dynastyKey && SCENE_DYNASTY_LABELS[dynastyKey]) {
    return SCENE_DYNASTY_LABELS[dynastyKey];
  }
  return normalizeDynastyText(normalized);
}

export function worldCharacterHeroSubtitle(source: SourceDetailData): string | null {
  const textCandidates = [
    source.characterProfile.archetype,
    source.characterProfile.role,
    source.worldId,
    source.entity?.summary,
    source.bio,
    ...(source.entity?.tags ?? []),
    ...source.tags,
  ];
  for (const candidate of textCandidates) {
    const label = normalizeDynastyText(String(candidate || ''));
    if (label) {
      return label;
    }
  }
  return null;
}

function firstTextValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return simplifyDisplayText(value.trim());
    }
  }
  return null;
}

function factMatches(record: Record<string, unknown>, patterns: readonly RegExp[]): boolean {
  const text = [
    firstTextValue(record, ['key', 'name', 'label', 'title', 'type']),
  ].filter(Boolean).join(' ');
  return patterns.some((pattern) => pattern.test(text));
}

function readNamedFact(source: SourceDetailData, patterns: readonly RegExp[]): string | null {
  for (const fact of source.entity?.facts ?? []) {
    if (!factMatches(fact, patterns)) {
      continue;
    }
    const value = firstTextValue(fact, ['value', 'summary', 'text', 'content', 'name', 'label', 'title']);
    if (value) {
      return value.replace(/^(?:字|号|號|courtesy name|style name|art name|hao|zi)\s*[:：]?\s*/iu, '').trim() || null;
    }
  }
  return null;
}

function readDelimitedNamePart(values: readonly (string | null | undefined)[], marker: '字' | '号'): string | null {
  const pattern = marker === '字'
    ? /(?:^|[，,；;。]\s*)字\s*([^，,；;。]+)/u
    : /(?:^|[，,；;。]\s*)号\s*([^，,；;。]+)/u;
  for (const value of values) {
    const normalized = simplifyDisplayText(String(value || '').trim());
    const match = pattern.exec(normalized);
    const part = match?.[1]?.trim();
    if (part) {
      return part;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function trimHeroPhrase(value: string): string {
  return value.replace(/^[，,；;\s]+/u, '').replace(/[，,；;\s]+$/u, '').trim();
}

function conciseRoleText(source: SourceDetailData): string | null {
  const role = simplifyDisplayText(String(source.characterProfile.role || '').trim()).replace(/、/gu, '，');
  if (role) {
    return role;
  }
  const fallback = simplifyDisplayText(String(source.bio || source.entity?.summary || '').trim())
    .replace(new RegExp(`^${escapeRegExp(source.displayName)}[，,\\s]*`, 'u'), '')
    .replace(/(?:^|[，,；;。])(?:字|号)\s*[^，,；;。]+/gu, '')
    .split(/[。；;]/u)[0]
    ?.trim()
    .replace(/、/gu, '，');
  return fallback ? trimHeroPhrase(fallback) || null : null;
}

function dynastyDescriptionPrefix(dynastyLabel: string | null): string | null {
  return dynastyLabel?.split('/')[0]?.trim() || null;
}

export function worldCharacterHeroDescription(source: SourceDetailData, dynastyLabel: string | null): string | null {
  const textSources = [
    source.entity?.summary,
    source.bio,
    source.characterProfile.interaction?.greeting,
    ...source.characterProfile.conversationAnchors,
  ];
  const zi = readNamedFact(source, [/^(?:zi|courtesyName|courtesy_name|styleName|style_name)$/iu, /(?:^|[^一-龥])courtesy(?:\s+name)?/iu, /字/u])
    ?? readDelimitedNamePart(textSources, '字');
  const hao = readNamedFact(source, [/^(?:hao|artName|art_name)$/iu, /(?:^|[^一-龥])art(?:\s+name)?/iu, /号|號/u])
    ?? readDelimitedNamePart(textSources, '号');
  const role = conciseRoleText(source);
  const dynastyPrefix = dynastyDescriptionPrefix(dynastyLabel);
  const roleWithDynasty = role
    ? dynastyPrefix && !role.includes(dynastyPrefix) ? `${dynastyPrefix}${role}` : role
    : dynastyPrefix;
  const parts = uniqueStrings([
    roleWithDynasty,
    zi ? `字${zi}` : null,
    hao ? `号${hao}` : null,
  ]);
  return parts.length > 0 ? parts.join('，') : null;
}

export function topicChips(source: SourceDetailData): string[] {
  return [
    source.characterProfile.role,
    source.characterProfile.archetype,
    ...source.characterProfile.traits,
    ...source.characterProfile.knowledgeTopics,
    ...source.characterProfile.interactionModes,
    ...source.works.map((work) => work.title),
  ]
    .filter((value): value is string => Boolean(value))
    .map(simplifyDisplayText)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8);
}

export function worldCharacterPrimaryActionLabel(
  action: ReturnType<typeof describeCharacterPrimaryAction>,
  t: TranslationFn,
): string {
  if (action.action === 'become_partner') {
    return t('SourceDetail.worldCharacter.primaryActionMaterialize', {
      defaultValue: action.label,
    });
  }
  return action.label;
}

export function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}
