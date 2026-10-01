import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { CharacterSourceState } from '../explore/character-source-materialization';
import {
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../realm-source/realm-source-identity.js';
import {
  readOptionalString,
  readSourceMediaUrl,
  readStringArray,
  readVoiceSample,
} from './source-detail-model-readers.js';
import {
  dedupeWorks,
  readCareerMilestonesFromRelationships,
  readCharacterProfile,
  readRelationshipClues,
  readRelationshipRows,
  readRelationshipTargetLabels,
  readWorldCharacterWorksFromRelationships,
} from './source-detail-world-character-model.js';
import type {
  CharacterProfileMilestoneProjection,
  CharacterProfileProjection,
  CharacterSourceViewerRelationProjection,
} from '../realm-source/character-source-profile-projection.js';

export type SourceDetailData = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  profileCoverUrl: string | null;
  referenceImageUrl: string | null;
  voiceSample: SourceDetailVoiceSample | null;
  bio: string | null;
  createdAt: string;
  tags: string[];
  isOnline: boolean;
  archetype: string | null;
  cadence: string | null;
  visibility: string | null;
  ownership: 'worldOwned' | 'userOwned' | null;
  viewerRelation: CharacterSourceViewerRelationProjection;
  worldId: string;
  worldName: string | null;
  sourceKind: CharacterSourceRefV3['kind'];
  sourceId: string;
  sourceHash: string;
  runtimeSourceRef: string | null;
  sourceRef: CharacterSourceRefV3;
  entity: SourceDetailEntity | null;
  characterProfile: CharacterProfileProjection;
  worldCharacterAugmentation: SourceDetailWorldCharacterAugmentation | null;
  relationshipClues: SourceDetailRelationshipClue[];
  relationshipTargetLabels: Record<string, string>;
  works: SourceDetailWorkCollection[];
  worksAvailability: 'available' | 'unavailable';
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
  // True when the row is literary-exchange evidence without an identifiable
  // work title; its title is the generic relation label (e.g. 著述线索) and it
  // renders as a text clue, not as a work card.
  textClue?: boolean;
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

export type SourceDetailWorldCharacterMilestone = CharacterProfileMilestoneProjection;

export type SourceDetailWorldCharacterAugmentation = {
  careerMilestones: SourceDetailWorldCharacterMilestone[];
};

// A WorldCharacter relationship row shown as authored. `type` is the row's
// explicit relationship type, or null when the row declares none (rendered
// neutrally, never dropped or reclassified from its text).
export type SourceDetailRelationshipClue = {
  id: string;
  type: string | null;
  label: string | null;
  targetLabel: string | null;
  targetEntityId: string | null;
  summary: string | null;
  details: string[];
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

function readSourceViewerRelation(value: unknown): CharacterSourceViewerRelationProjection | null {
  const relation = parseOptionalJsonObject(value);
  if (!relation) {
    return null;
  }
  const state = relation.state;
  if (state !== 'connectable' && state !== 'connected' && state !== 'unavailable') {
    return null;
  }
  return {
    state,
    connectionId: readOptionalString(relation, 'connectionId'),
    runtimeSourceRef: readOptionalString(relation, 'runtimeSourceRef'),
  };
}

function readProfileWorks(profile: CharacterProfileProjection): SourceDetailWorkCollection[] {
  return profile.milestones
    .filter((milestone) => milestone.kind === 'work')
    .map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      romanizedTitle: null,
      textId: null,
      rowRef: null,
      role: null,
      status: 'unknown',
      summary: milestone.summary,
      timeLabel: milestone.timeLabel,
    }));
}

export function toSourceDetailData(
  raw: JsonObject,
  sourceState: CharacterSourceState,
): SourceDetailData {
  const world = parseOptionalJsonObject(raw.world);
  const sourceRef = readCharacterSourceRefV3(raw.sourceRef);
  if (!sourceRef) {
    throw new Error('Source detail projection requires complete CharacterSourceRefV3');
  }
  const sourceKind = sourceRef.kind;
  const worldId = sourceRef.worldId;
  const sourceId = sourceRef.id;
  const sourceHash = sourceRef.sourceHash;
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  if (!displayName) {
    throw new Error('Source detail projection requires displayName from WorldPublicSourceCard');
  }
  const relationships = readRelationshipRows(raw.relationships);
  const careerMilestones = sourceKind === 'worldCharacter'
    ? readCareerMilestonesFromRelationships(relationships)
    : [];
  const characterProfile = readCharacterProfile(raw.characterProfile);
  if (!characterProfile) {
    throw new Error('Source detail projection requires shared characterProfile');
  }
  const viewerRelation = readSourceViewerRelation(raw.viewerRelation);
  if (!viewerRelation) {
    throw new Error('Source detail projection requires viewerRelation from WorldPublicSourceCard');
  }
  const works = dedupeWorks([
    ...readProfileWorks(characterProfile),
    ...(sourceKind === 'worldCharacter'
      ? readWorldCharacterWorksFromRelationships(relationships)
      : []),
  ]);
  const avatarUrl = readSourceMediaUrl(raw, 'avatar', 'avatarUrl')
    ?? readSourceMediaUrl(raw, 'portrait', 'portraitUrl')
    ?? readSourceMediaUrl(raw, 'referenceImage', 'referenceImageUrl');
  const profileCoverUrl = readSourceMediaUrl(raw, 'profileCover', 'profileCoverUrl');
  const referenceImageUrl = readSourceMediaUrl(raw, 'referenceImage', 'referenceImageUrl');
  const voiceSample = readVoiceSample(raw);
  const ownership = raw.ownership === 'worldOwned' || raw.ownership === 'userOwned'
    ? raw.ownership
    : null;

  const detail: SourceDetailData = {
    id: sourceId,
    displayName,
    handle: String(raw.handle || ''),
    avatarUrl,
    profileCoverUrl,
    referenceImageUrl,
    voiceSample,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    isOnline: raw.isOnline === true,
    archetype: characterProfile.archetype,
    cadence: characterProfile.interaction?.cadence ?? null,
    visibility: typeof raw.visibility === 'string' ? raw.visibility : null,
    ownership,
    viewerRelation,
    worldId,
    worldName: typeof raw.worldName === 'string' ? raw.worldName : null,
    sourceKind,
    sourceId,
    sourceHash,
    runtimeSourceRef: (
      (typeof raw.runtimeSourceRef === 'string' ? raw.runtimeSourceRef.trim() : '')
      || viewerRelation.runtimeSourceRef
      || null
    ),
    sourceRef,
    entity: readSourceDetailEntity(raw.entity),
    characterProfile,
    worldCharacterAugmentation: sourceKind === 'worldCharacter'
      ? { careerMilestones }
      : null,
    relationshipClues: sourceKind === 'worldCharacter' ? readRelationshipClues(relationships) : [],
    relationshipTargetLabels: sourceKind === 'worldCharacter' ? readRelationshipTargetLabels(relationships) : {},
    works,
    worksAvailability: works.length > 0 ? 'available' : 'unavailable',
    sourceState,
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || readOptionalString(world, 'bannerUrl')
    ),
  };
  // Source text is presented as authored: no script conversion or rewriting.
  return detail;
}
