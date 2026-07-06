import {
  projectWorldPublicSourceCard,
  requireWorldPublicSourceCardDto,
} from './data/world-public-projection.js';
import type {
  WorldAssetExternalRef,
  WorldAssetIntent,
  WorldAssetResourceRef,
  WorldCharacter,
  WorldPublicAssetsData,
  WorldPublicMediaAsset,
  WorldSceneCounts,
  WorldSceneEntity,
  WorldSceneItem,
  WorldSceneResource,
} from './world-detail-types.js';
import {
  asRecord,
  readNumber,
  readPublicMediaAsset,
  readRecordArray,
  readString,
  readStringArray,
} from './world-detail-query-readers.js';
import { toWorldDisplayCharacter } from './world-detail-primary-projection.js';
import { toWorldDisplayHistoryItem } from './world-detail-history-projection.js';

type WorldPublicAssetListPayload = {
  readonly resourceRefs: readonly unknown[];
  readonly externalRefs: readonly unknown[];
  readonly intents: readonly unknown[];
};

type WorldPublicSceneListPayload = {
  readonly items: readonly unknown[];
};

function toWorldDisplayResourceRef(rawValue: unknown, index: number): WorldAssetResourceRef {
  const raw = asRecord(rawValue);
  const refId = readString(raw, 'refId') || `resource-ref-${index + 1}`;
  return {
    refId,
    kind: readString(raw, 'kind') || 'resource',
    purpose: readString(raw, 'purpose') || null,
    label: readString(raw, 'label') || null,
  };
}

function toWorldDisplayExternalRef(rawValue: unknown, index: number): WorldAssetExternalRef | null {
  const raw = asRecord(rawValue);
  const uri = readString(raw, 'uri');
  if (!uri) {
    return null;
  }
  return {
    ...toWorldDisplayResourceRef(raw, index),
    uri,
  };
}

function toWorldDisplayAssetIntent(rawValue: unknown, index: number): WorldAssetIntent {
  const raw = asRecord(rawValue);
  const intentId = readString(raw, 'intentId') || `asset-intent-${index + 1}`;
  return {
    intentId,
    kind: readString(raw, 'kind') || 'asset',
    summary: readString(raw, 'summary') || null,
  };
}

function toWorldDisplaySceneEntity(rawValue: unknown, index: number): WorldSceneEntity {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id', 'entityId') || readString(raw, 'label', 'name') || `scene-entity-${index + 1}`;
  return {
    id,
    kind: readString(raw, 'kind') || 'entity',
    label: readString(raw, 'label', 'name') || null,
    summary: readString(raw, 'summary') || null,
  };
}

function toWorldDisplaySceneCharacter(rawValue: unknown): WorldCharacter {
  const raw = asRecord(rawValue);
  const sourceRef = asRecord(raw.sourceRef);
  const worldId = readString(raw, 'worldId') || readString(sourceRef, 'worldId');
  const projected = projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(raw, worldId));
  return toWorldDisplayCharacter(projected, readString(raw, 'updatedAt', 'createdAt') || new Date(0).toISOString());
}

function toWorldDisplaySceneResource(rawValue: unknown, index: number): WorldSceneResource {
  const raw = asRecord(rawValue);
  const id = readString(raw, 'id') || `scene-resource-${index + 1}`;
  return {
    id,
    kind: readString(raw, 'kind') || 'resource',
    title: readString(raw, 'title', 'label') || id,
    summary: readString(raw, 'summary') || null,
    entityRefs: readStringArray(raw.entityRefs),
    eventRefs: readStringArray(raw.eventRefs),
  };
}

function toWorldDisplaySceneCounts(
  rawValue: unknown,
  lengths: {
    readonly activeEntities: number;
    readonly relatedCharacters: number;
    readonly relatedEvents: number;
    readonly relatedResources: number;
  },
): WorldSceneCounts {
  const raw = asRecord(rawValue);
  return {
    activeEntityCount: readNumber(raw.activeEntityCount) ?? lengths.activeEntities,
    relatedCharacterCount: readNumber(raw.relatedCharacterCount) ?? lengths.relatedCharacters,
    relatedEventCount: readNumber(raw.relatedEventCount) ?? lengths.relatedEvents,
    relatedResourceCount: readNumber(raw.relatedResourceCount) ?? lengths.relatedResources,
  };
}

function toWorldDisplaySceneItem(rawValue: unknown, index: number): WorldSceneItem {
  const raw = asRecord(rawValue);
  const activeEntities = readRecordArray(raw.activeEntities)
    .map(toWorldDisplaySceneEntity);
  const relatedCharacters = readRecordArray(raw.relatedCharacters)
    .map(toWorldDisplaySceneCharacter);
  const relatedEvents = readRecordArray(raw.relatedEvents)
    .map((event, eventIndex) => toWorldDisplayHistoryItem(event, eventIndex));
  const relatedResources = readRecordArray(raw.relatedResources)
    .map(toWorldDisplaySceneResource);
  const media = readRecordArray(raw.media)
    .map(readPublicMediaAsset)
    .filter((asset): asset is WorldPublicMediaAsset => asset !== null);
  return {
    id: readString(raw, 'sceneId', 'id') || `scene-${index + 1}`,
    name: readString(raw, 'name', 'title') || 'Unnamed scene',
    description: readString(raw, 'summary', 'description'),
    activeEntities,
    relatedCharacters,
    relatedEvents,
    relatedResources,
    counts: toWorldDisplaySceneCounts(raw.counts, {
      activeEntities: activeEntities.length,
      relatedCharacters: relatedCharacters.length,
      relatedEvents: relatedEvents.length,
      relatedResources: relatedResources.length,
    }),
    media,
  };
}

export function toWorldPublicAssetsData(
  assetsPayload: WorldPublicAssetListPayload,
  scenesPayload: WorldPublicSceneListPayload,
): WorldPublicAssetsData {
  return {
    resourceRefs: assetsPayload.resourceRefs.map(toWorldDisplayResourceRef),
    externalRefs: assetsPayload.externalRefs
      .map(toWorldDisplayExternalRef)
      .filter((item): item is WorldAssetExternalRef => item !== null),
    intents: assetsPayload.intents.map(toWorldDisplayAssetIntent),
    scenes: scenesPayload.items.map(toWorldDisplaySceneItem),
  };
}
