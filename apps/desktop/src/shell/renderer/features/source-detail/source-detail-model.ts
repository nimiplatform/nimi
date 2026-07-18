import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { CharacterSourceState } from '@renderer/features/explore/character-source-materialization';
import {
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '@renderer/features/realm-source/realm-source-identity.js';
import {
  readExternalAssetUri,
  readOptionalString,
  readSourceMediaUrl,
  readStringArray,
  readVoiceDesign,
  readVoiceSample,
  readWorldStudioVoiceDesign,
} from './source-detail-model-readers.js';
import {
  dedupeWorks,
  readCareerMilestonesFromRelationships,
  readRelationshipClues,
  readRelationshipRows,
  readWorldCharacter,
  readWorldCharacterWorks,
  readWorldCharacterWorksFromBiography,
  readWorldCharacterWorksFromRelationships,
} from './source-detail-world-character-model.js';
import { simplifySourceDetailChineseText } from './source-detail-simplified-chinese.js';


export type SourceDetailData = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  profileCoverUrl: string | null;
  referenceImageUrl: string | null;
  voiceSample: SourceDetailVoiceSample | null;
  voiceDesign: SourceDetailVoiceDesign | null;
  bio: string | null;
  createdAt: string;
  tags: string[];
  isOnline: boolean;
  state: string | null;
  archetype: string | null;
  origin: string | null;
  tier: string | null;
  pacing: string | null;
  visibility: string | null;
  ownershipType: string | null;
  worldId: string | null;
  sourceKind: CharacterSourceRefV3['kind'] | null;
  sourceId: string | null;
  sourceHash: string | null;
  runtimeSourceRef: string | null;
  sourceRef: CharacterSourceRefV3 | null;
  entity: SourceDetailEntity | null;
  worldCharacter: SourceDetailWorldCharacter | null;
  relationshipClues: SourceDetailRelationshipClue[];
  works: SourceDetailWorkCollection[];
  worksAvailability: 'available' | 'unavailable';
  isFriend: boolean;
  sourceState: CharacterSourceState;
  worldBannerUrl: string | null;
};

export type SourceDetailWorkCollection = {
  id: string;
  title: string;
  romanizedTitle: string | null;
  textId: string | null;
  rowRef: string | null;
  role: string | null;
  status: 'resolved' | 'unresolved' | 'unknown';
  summary?: string | null;
  timeLabel?: string | null;
};

export type SourceDetailEntity = {
  id: string;
  kind: string;
  name: string;
  summary: string | null;
  contentHash: string;
  tags: string[];
  facts: JsonObject[];
};

export type SourceDetailWorldCharacter = {
  role: string | null;
  faction: string | null;
  rank: string | null;
  sceneRefs: string[];
  milestones: SourceDetailWorldCharacterMilestone[];
  relationshipNotes: SourceDetailWorldCharacterRelationshipNote[];
  conversationAnchors: string[];
  interaction: SourceDetailWorldCharacterInteraction | null;
};

export type SourceDetailWorldCharacterMilestone = {
  id: string;
  title: string;
  summary: string | null;
  sequence: number | null;
  timeLabel: string | null;
  kind: 'biography' | 'entry' | 'office' | 'work';
  derived: boolean;
};

export type SourceDetailWorldCharacterRelationshipNote = {
  id: string;
  type: string;
  targetRef: string | null;
  summary: string;
};

export type SourceDetailWorldCharacterInteraction = {
  tone: string | null;
  cadence: string | null;
  scenario: string | null;
  greeting: string | null;
};

export type SourceDetailRelationshipClue = {
  id: string;
  type: string;
  label: string;
  targetLabel: string | null;
  summary: string | null;
  detail: string | null;
};

export type SourceDetailVoiceDesign = {
  voiceId: string;
  sampleUri: string;
  provider: string;
  workflow: string;
  model: string;
  prompt: string;
  transcript: string;
  previewText: string;
};

export type SourceDetailVoiceSample = {
  id: string;
  url: string;
  provider: string | null;
  mimeType: string | null;
  durationSec: number | null;
  sha256: string | null;
  transcript: string | null;
  previewText: string | null;
};

function readEntityFacts(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(parseOptionalJsonObject).filter((item): item is JsonObject => Boolean(item))
    : [];
}

function readSourceDetailEntity(value: unknown): SourceDetailEntity | null {
  const entity = parseOptionalJsonObject(value);
  if (!entity) {
    return null;
  }
  const id = readOptionalString(entity, 'id');
  const kind = readOptionalString(entity, 'kind');
  const name = readOptionalString(entity, 'name');
  const contentHash = readOptionalString(entity, 'contentHash');
  if (!id || !kind || !name || !contentHash) {
    return null;
  }
  return {
    id,
    kind,
    name,
    summary: readOptionalString(entity, 'summary'),
    contentHash,
    tags: readStringArray(entity.tags),
    facts: readEntityFacts(entity.facts),
  };
}

function simplifyNullableText(value: string | null): string | null {
  return value ? simplifySourceDetailChineseText(value) : value;
}

function simplifyTextArray(values: string[]): string[] {
  return values.map(simplifySourceDetailChineseText);
}

function simplifySourceDetailEntity(entity: SourceDetailEntity | null): SourceDetailEntity | null {
  if (!entity) {
    return null;
  }
  return {
    ...entity,
    name: simplifySourceDetailChineseText(entity.name),
    summary: simplifyNullableText(entity.summary),
    tags: simplifyTextArray(entity.tags),
  };
}

function simplifySourceDetailWorks(works: SourceDetailWorkCollection[]): SourceDetailWorkCollection[] {
  return works.map((work) => ({
    ...work,
    title: simplifySourceDetailChineseText(work.title),
    romanizedTitle: simplifyNullableText(work.romanizedTitle),
    role: simplifyNullableText(work.role),
    ...(work.summary !== undefined ? { summary: simplifyNullableText(work.summary ?? null) } : {}),
    ...(work.timeLabel !== undefined ? { timeLabel: simplifyNullableText(work.timeLabel ?? null) } : {}),
  }));
}

function simplifyWorldCharacterMilestones(
  milestones: SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacterMilestone[] {
  return milestones.map((milestone) => ({
    ...milestone,
    title: simplifySourceDetailChineseText(milestone.title),
    summary: simplifyNullableText(milestone.summary),
    timeLabel: simplifyNullableText(milestone.timeLabel),
  }));
}

function simplifyWorldCharacterRelationshipNotes(
  notes: SourceDetailWorldCharacterRelationshipNote[],
): SourceDetailWorldCharacterRelationshipNote[] {
  return notes.map((note) => ({
    ...note,
    summary: simplifySourceDetailChineseText(note.summary),
  }));
}

function simplifyWorldCharacterInteraction(
  interaction: SourceDetailWorldCharacterInteraction | null,
): SourceDetailWorldCharacterInteraction | null {
  if (!interaction) {
    return null;
  }
  return {
    tone: simplifyNullableText(interaction.tone),
    cadence: simplifyNullableText(interaction.cadence),
    scenario: simplifyNullableText(interaction.scenario),
    greeting: simplifyNullableText(interaction.greeting),
  };
}

function simplifySourceDetailWorldCharacter(
  character: SourceDetailWorldCharacter | null,
): SourceDetailWorldCharacter | null {
  if (!character) {
    return null;
  }
  return {
    ...character,
    role: simplifyNullableText(character.role),
    faction: simplifyNullableText(character.faction),
    rank: simplifyNullableText(character.rank),
    milestones: simplifyWorldCharacterMilestones(character.milestones),
    relationshipNotes: simplifyWorldCharacterRelationshipNotes(character.relationshipNotes),
    conversationAnchors: simplifyTextArray(character.conversationAnchors),
    interaction: simplifyWorldCharacterInteraction(character.interaction),
  };
}

function simplifySourceDetailRelationshipClues(
  clues: SourceDetailRelationshipClue[],
): SourceDetailRelationshipClue[] {
  return clues.map((clue) => ({
    ...clue,
    label: simplifySourceDetailChineseText(clue.label),
    targetLabel: simplifyNullableText(clue.targetLabel),
    summary: simplifyNullableText(clue.summary),
    detail: simplifyNullableText(clue.detail),
  }));
}

function simplifySourceDetailVoiceDesign(
  voiceDesign: SourceDetailVoiceDesign | null,
): SourceDetailVoiceDesign | null {
  if (!voiceDesign) {
    return null;
  }
  return {
    ...voiceDesign,
    prompt: simplifySourceDetailChineseText(voiceDesign.prompt),
    transcript: simplifySourceDetailChineseText(voiceDesign.transcript),
    previewText: simplifySourceDetailChineseText(voiceDesign.previewText),
  };
}

function simplifySourceDetailVoiceSample(
  voiceSample: SourceDetailVoiceSample | null,
): SourceDetailVoiceSample | null {
  if (!voiceSample) {
    return null;
  }
  return {
    ...voiceSample,
    transcript: simplifyNullableText(voiceSample.transcript),
    previewText: simplifyNullableText(voiceSample.previewText),
  };
}

function simplifyWorldCharacterSourceDetailData(detail: SourceDetailData): SourceDetailData {
  return {
    ...detail,
    displayName: simplifySourceDetailChineseText(detail.displayName),
    bio: simplifyNullableText(detail.bio),
    tags: simplifyTextArray(detail.tags),
    archetype: simplifyNullableText(detail.archetype),
    pacing: simplifyNullableText(detail.pacing),
    voiceSample: simplifySourceDetailVoiceSample(detail.voiceSample),
    voiceDesign: simplifySourceDetailVoiceDesign(detail.voiceDesign),
    entity: simplifySourceDetailEntity(detail.entity),
    worldCharacter: simplifySourceDetailWorldCharacter(detail.worldCharacter),
    relationshipClues: simplifySourceDetailRelationshipClues(detail.relationshipClues),
    works: simplifySourceDetailWorks(detail.works),
  };
}

export function toSourceDetailData(
  raw: JsonObject,
  sourceState: CharacterSourceState,
): SourceDetailData {
  const sourceRecord = parseOptionalJsonObject(raw.source);
  const world = parseOptionalJsonObject(raw.world);
  const personaStyle = parseOptionalJsonObject(sourceRecord?.personaStyle);
  const sourceRef = readCharacterSourceRefV3(raw.sourceRef);
  const sourceKind = sourceRef?.kind ?? null;
  const worldId = sourceRef?.worldId ?? null;
  const sourceId = sourceRef?.id ?? null;
  const sourceHash = sourceRef?.sourceHash ?? '';
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  if (!displayName) {
    throw new Error('Source detail projection requires displayName from Realm Core');
  }
  const relationships = readRelationshipRows(raw.relationships);
  const sourceRelationships = readRelationshipRows(sourceRecord?.relationships);
  const careerMilestones = sourceKind === 'worldCharacter'
    ? readCareerMilestonesFromRelationships([...sourceRelationships, ...relationships])
    : [];
  const works = sourceKind === 'worldCharacter'
    ? dedupeWorks([
        ...readWorldCharacterWorks(sourceRecord),
        ...readWorldCharacterWorksFromBiography(sourceRecord),
        ...readWorldCharacterWorksFromRelationships(sourceRelationships),
        ...readWorldCharacterWorksFromRelationships(relationships),
      ])
    : [];
  const avatarUrl = readSourceMediaUrl(raw, 'avatar', 'avatarUrl')
    ?? readSourceMediaUrl(raw, 'portrait', 'portraitUrl')
    ?? readSourceMediaUrl(raw, 'referenceImage', 'referenceImageUrl')
    ?? readExternalAssetUri(sourceRecord, ['avatar', 'referenceImage', 'portrait']);
  const profileCoverUrl = readSourceMediaUrl(raw, 'profileCover', 'profileCoverUrl')
    ?? readExternalAssetUri(sourceRecord, ['profileCover', 'cover']);
  const referenceImageUrl = readSourceMediaUrl(raw, 'referenceImage', 'referenceImageUrl')
    ?? readExternalAssetUri(sourceRecord, ['referenceImage']);
  const voiceSample = readVoiceSample(raw);

  const detail: SourceDetailData = {
    id: String(raw.id || ''),
    displayName,
    handle: String(raw.handle || ''),
    avatarUrl,
    profileCoverUrl,
    referenceImageUrl,
    voiceSample,
    voiceDesign: readVoiceDesign(parseOptionalJsonObject(raw.voiceDesign))
      ?? readWorldStudioVoiceDesign(sourceRecord),
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    isOnline: raw.isOnline === true,
    state: readOptionalString(sourceRecord, 'state'),
    archetype: (
      (typeof raw.archetype === 'string' ? raw.archetype : null)
      || readOptionalString(personaStyle, 'archetype')
    ),
    origin: readOptionalString(sourceRecord, 'origin'),
    tier: readOptionalString(sourceRecord, 'tier'),
    pacing: (
      (typeof raw.pacing === 'string' ? raw.pacing : null)
      || readOptionalString(personaStyle, 'pacing')
    ),
    visibility: (
      (typeof raw.visibility === 'string' ? raw.visibility : null)
      || (sourceRecord && typeof sourceRecord.visibility === 'string' ? sourceRecord.visibility : null)
    ),
    ownershipType: readOptionalString(sourceRecord, 'ownershipType'),
    worldId,
    sourceKind,
    sourceId,
    sourceHash,
    runtimeSourceRef: (
      (typeof raw.runtimeSourceRef === 'string' ? raw.runtimeSourceRef.trim() : '')
      || null
    ),
    sourceRef,
    entity: readSourceDetailEntity(raw.entity),
    worldCharacter: sourceKind === 'worldCharacter' ? readWorldCharacter(sourceRecord, careerMilestones) : null,
    relationshipClues: sourceKind === 'worldCharacter' ? readRelationshipClues(relationships) : [],
    works,
    worksAvailability: works.length > 0 ? 'available' : 'unavailable',
    isFriend: raw.isFriend === true,
    sourceState,
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || readOptionalString(sourceRecord, 'worldBannerUrl')
      || readOptionalString(world, 'bannerUrl')
    ),
  };
  return sourceKind === 'worldCharacter' ? simplifyWorldCharacterSourceDetailData(detail) : detail;
}

export function getSourceInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function getStateBadgeColor(state: string): { bg: string; text: string; dot: string } {
  switch (state) {
    case 'ACTIVE':
      return { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' };
    case 'READY':
      return { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' };
    case 'INCUBATING':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' };
    case 'SUSPENDED':
      return { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' };
    case 'FAILED':
      return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };
  }
}
