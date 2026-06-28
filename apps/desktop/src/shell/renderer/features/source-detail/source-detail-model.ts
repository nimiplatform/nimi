import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { RealmPersonaSourceState } from '@renderer/features/explore/realm-persona-source-materialization';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';

export type SourceDetailData = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  profileCoverUrl: string | null;
  referenceImageUrl: string | null;
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
  sourceKind: NimiRealmCoreSourceRef['kind'] | null;
  sourceId: string | null;
  sourceContentHash: string | null;
  runtimeSourceRef: string | null;
  sourceRef: NimiRealmCoreSourceRef | null;
  entity: SourceDetailEntity | null;
  isFriend: boolean;
  sourceState: RealmPersonaSourceState;
  worldBannerUrl: string | null;
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

function readOptionalString(record: JsonObject | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readExternalAssetUri(core: JsonObject | null | undefined, kinds: readonly string[]): string | null {
  const assets = parseOptionalJsonObject(core?.assets);
  const refs = Array.isArray(assets?.externalRefs) ? assets.externalRefs : [];
  for (const ref of refs) {
    const record = parseOptionalJsonObject(ref);
    const kind = readOptionalString(record, 'kind');
    if (kind && kinds.includes(kind)) {
      const uri = readOptionalString(record, 'uri');
      if (uri) return uri;
    }
  }
  return null;
}

function readVoiceDesign(record: JsonObject | null | undefined): SourceDetailVoiceDesign | null {
  const voiceId = readOptionalString(record, 'voiceId');
  const sampleUri = readOptionalString(record, 'sampleUri');
  const provider = readOptionalString(record, 'provider');
  const workflow = readOptionalString(record, 'workflow');
  const model = readOptionalString(record, 'model');
  const prompt = readOptionalString(record, 'prompt');
  const transcript = readOptionalString(record, 'transcript');
  const previewText = readOptionalString(record, 'previewText');
  if (!voiceId || !sampleUri || !provider || !workflow || !model || !prompt || !transcript || !previewText) {
    return null;
  }
  return {
    voiceId,
    sampleUri,
    provider,
    workflow,
    model,
    prompt,
    transcript,
    previewText,
  };
}

function readWorldStudioVoiceDesign(core: JsonObject | null | undefined): SourceDetailVoiceDesign | null {
  const authoring = parseOptionalJsonObject(core?.authoring);
  const extensions = parseOptionalJsonObject(authoring?.extensions);
  const worldStudioSettings = parseOptionalJsonObject(extensions?.worldStudioSettings);
  return readVoiceDesign(parseOptionalJsonObject(worldStudioSettings?.voice));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

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

export function toSourceDetailData(
  raw: JsonObject,
  sourceState: RealmPersonaSourceState,
): SourceDetailData {
  const sourceRecord = parseOptionalJsonObject(raw.source);
  const world = parseOptionalJsonObject(raw.world);
  const personaStyle = parseOptionalJsonObject(sourceRecord?.personaStyle);
  const sourceKindRaw = String(raw.sourceKind || '').trim();
  const sourceKind: NimiRealmCoreSourceRef['kind'] | null = sourceKindRaw === 'worldCharacter' || sourceKindRaw === 'realmPersona'
    ? sourceKindRaw
    : null;
  const worldId = (
    (sourceRecord && typeof sourceRecord.worldId === 'string' ? sourceRecord.worldId : null)
    || (typeof raw.homeWorldId === 'string' ? raw.homeWorldId : null)
    || (typeof raw.worldId === 'string' ? raw.worldId : null)
  );
  const sourceId = typeof raw.sourceId === 'string' && raw.sourceId.trim()
    ? raw.sourceId.trim()
    : String(raw.id || '').trim() || null;
  const sourceContentHash = (
    (typeof raw.sourceContentHash === 'string' ? raw.sourceContentHash.trim() : '')
    || (typeof raw.contentHash === 'string' ? raw.contentHash.trim() : '')
    || readOptionalString(sourceRecord, 'sourceContentHash')
    || readOptionalString(sourceRecord, 'contentHash')
  );
  const sourceRef: NimiRealmCoreSourceRef | null = sourceKind && worldId && sourceId && sourceContentHash
    ? {
        kind: sourceKind,
        worldId,
        sourceId,
        sourceContentHash,
      }
    : null;
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  if (!displayName) {
    throw new Error('Source detail projection requires displayName from Realm Core');
  }

  return {
    id: String(raw.id || ''),
    displayName,
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    profileCoverUrl: (
      (typeof raw.profileCoverUrl === 'string' && raw.profileCoverUrl.trim() ? raw.profileCoverUrl.trim() : null)
      || readExternalAssetUri(sourceRecord, ['profileCover', 'cover'])
    ),
    referenceImageUrl: (
      (typeof raw.referenceImageUrl === 'string' && raw.referenceImageUrl.trim() ? raw.referenceImageUrl.trim() : null)
      || readExternalAssetUri(sourceRecord, ['referenceImage'])
    ),
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
    sourceContentHash,
    runtimeSourceRef: (
      (typeof raw.runtimeSourceRef === 'string' ? raw.runtimeSourceRef.trim() : '')
      || null
    ),
    sourceRef,
    entity: readSourceDetailEntity(raw.entity),
    isFriend: raw.isFriend === true,
    sourceState,
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || readOptionalString(sourceRecord, 'worldBannerUrl')
      || readOptionalString(world, 'bannerUrl')
    ),
  };
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
