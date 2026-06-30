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
  sourceKind: NimiRealmCoreSourceRef['kind'] | null;
  sourceId: string | null;
  sourceContentHash: string | null;
  runtimeSourceRef: string | null;
  sourceRef: NimiRealmCoreSourceRef | null;
  entity: SourceDetailEntity | null;
  worldCharacter: SourceDetailWorldCharacter | null;
  relationshipClues: SourceDetailRelationshipClue[];
  works: SourceDetailWorkCollection[];
  worksAvailability: 'available' | 'unavailable';
  isFriend: boolean;
  sourceState: RealmPersonaSourceState;
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
  summary: string | null;
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

function readOptionalString(record: JsonObject | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPublicUrlValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function readExternalAssetUri(core: JsonObject | null | undefined, kinds: readonly string[]): string | null {
  const assets = parseOptionalJsonObject(core?.assets);
  const refs = Array.isArray(assets?.externalRefs) ? assets.externalRefs : [];
  for (const ref of refs) {
    const record = parseOptionalJsonObject(ref);
    const kind = readOptionalString(record, 'kind');
    if (kind && kinds.includes(kind)) {
      const uri = readOptionalString(record, 'uri');
      if (readPublicUrlValue(uri)) return uri;
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
  const publicSampleUri = readPublicUrlValue(sampleUri);
  if (!voiceId || !publicSampleUri || !provider || !workflow || !model || !prompt || !transcript || !previewText) {
    return null;
  }
  return {
    voiceId,
    sampleUri: publicSampleUri,
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

function readScalarString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPublicMediaAsset(value: unknown): JsonObject | null {
  const record = parseOptionalJsonObject(value);
  const id = readScalarString(record?.id);
  const kind = readScalarString(record?.kind);
  const url = readPublicUrlValue(record?.url);
  if (!id || !kind || !url) {
    return null;
  }
  return {
    ...record,
    id,
    kind,
    url,
  };
}

function readSourceMediaAsset(raw: JsonObject, kind: string): JsonObject | null {
  const media = parseOptionalJsonObject(raw.media);
  const assets = parseOptionalJsonObject(media?.assets) ?? parseOptionalJsonObject(raw.mediaAssets);
  return readPublicMediaAsset(assets?.[kind]);
}

function readSourceMediaUrl(raw: JsonObject, kind: string, scalarKey: string): string | null {
  const asset = readSourceMediaAsset(raw, kind);
  const assetUrl = readPublicUrlValue(asset?.url);
  if (assetUrl) {
    return assetUrl;
  }
  const media = parseOptionalJsonObject(raw.media);
  return readPublicUrlValue(media?.[scalarKey]) ?? readPublicUrlValue(raw[scalarKey]);
}

function readVoiceSample(raw: JsonObject): SourceDetailVoiceSample | null {
  const asset = readSourceMediaAsset(raw, 'voiceSample');
  const media = parseOptionalJsonObject(raw.media);
  const url = readPublicUrlValue(asset?.url)
    ?? readPublicUrlValue(media?.voiceSampleUrl)
    ?? readPublicUrlValue(raw.voiceSampleUrl);
  const id = readScalarString(asset?.id) ?? readScalarString(raw.voiceSampleId);
  if (!id || !url) {
    return null;
  }
  const provenance = parseOptionalJsonObject(asset?.provenance);
  return {
    id,
    url,
    provider: readScalarString(asset?.provider),
    mimeType: readScalarString(asset?.mimeType),
    durationSec: readFiniteNumber(asset?.durationSec),
    sha256: readScalarString(asset?.sha256),
    transcript: readScalarString(asset?.transcript) ?? readScalarString(provenance?.transcript),
    previewText: readScalarString(asset?.previewText) ?? readScalarString(provenance?.previewText),
  };
}

function readPath(record: JsonObject | null | undefined, path: readonly string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    const next = parseOptionalJsonObject(current);
    if (!next) {
      return undefined;
    }
    current = next[key];
  }
  return current;
}

function readRecordArray(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.map(parseOptionalJsonObject).filter((item): item is JsonObject => Boolean(item));
  }
  const record = parseOptionalJsonObject(value);
  return record ? Object.values(record).map(parseOptionalJsonObject).filter((item): item is JsonObject => Boolean(item)) : [];
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function normalizeWorkStatus(value: unknown): SourceDetailWorkCollection['status'] {
  const status = readScalarString(value)?.toLocaleLowerCase();
  if (status === 'resolved' || status === 'unresolved') {
    return status;
  }
  return 'unknown';
}

function readWorkTitle(row: JsonObject): string | null {
  return readOptionalString(row, 'titleChn')
    ?? readOptionalString(row, 'titleZh')
    ?? readOptionalString(row, 'chineseTitle')
    ?? readOptionalString(row, 'displayTitle')
    ?? readOptionalString(row, 'name')
    ?? readOptionalString(row, 'title');
}

function toWorkCollection(row: JsonObject, index: number): SourceDetailWorkCollection | null {
  const title = readWorkTitle(row);
  if (!title) {
    return null;
  }
  const textId = readScalarString(row.textId);
  const rowRef = readScalarString(row.rowRef);
  const hasNativeTitle = Boolean(
    readOptionalString(row, 'titleChn')
    ?? readOptionalString(row, 'titleZh')
    ?? readOptionalString(row, 'chineseTitle')
    ?? readOptionalString(row, 'displayTitle')
    ?? readOptionalString(row, 'name'),
  );
  return {
    id: readScalarString(row.id)
      ?? readScalarString(row.workId)
      ?? (textId ? `text-${textId}` : null)
      ?? rowRef
      ?? slug(title, String(index + 1)),
    title,
    romanizedTitle: hasNativeTitle ? readOptionalString(row, 'title') : readOptionalString(row, 'romanizedTitle'),
    textId,
    rowRef,
    role: readOptionalString(row, 'role') ?? readOptionalString(row, 'relationRole'),
    status: normalizeWorkStatus(row.joinStatus ?? row.status),
  };
}

function readWorldCharacterWorks(sourceCore: JsonObject | null | undefined): SourceDetailWorkCollection[] {
  const candidateRows = [
    readPath(sourceCore, ['authoring', 'extensions', 'sourcePerson', 'texts']),
    readPath(sourceCore, ['authoring', 'extensions', 'cbdb', 'sourcePerson', 'texts']),
    readPath(sourceCore, ['authoring', 'extensions', 'cbdb', 'texts']),
    readPath(sourceCore, ['authoring', 'extensions', 'works']),
    readPath(sourceCore, ['sourcePerson', 'texts']),
    readPath(sourceCore, ['works']),
  ].flatMap(readRecordArray);
  const seen = new Set<string>();
  return candidateRows
    .map(toWorkCollection)
    .filter((work): work is SourceDetailWorkCollection => Boolean(work))
    .filter((work) => {
      const key = work.textId ?? work.rowRef ?? work.title;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function relationshipCore(record: JsonObject): JsonObject {
  return parseOptionalJsonObject(record.core) ?? record;
}

function relationshipAttributes(record: JsonObject): JsonObject {
  const core = relationshipCore(record);
  return parseOptionalJsonObject(core.attributes)
    ?? parseOptionalJsonObject(record.attributes)
    ?? {};
}

function relationshipPresentation(record: JsonObject): JsonObject {
  return parseOptionalJsonObject(relationshipCore(record).presentation) ?? {};
}

function readRelationshipType(record: JsonObject): string | null {
  const core = relationshipCore(record);
  const endpoints = parseOptionalJsonObject(core.endpoints);
  return readOptionalString(record, 'type')
    ?? readOptionalString(endpoints, 'type')
    ?? readOptionalString(record, 'relationType')
    ?? readOptionalString(record, 'kind');
}

function readRelationshipSummary(record: JsonObject): string | null {
  const presentation = relationshipPresentation(record);
  return readOptionalString(presentation, 'summary')
    ?? readOptionalString(record, 'summary');
}

function readRelationshipId(record: JsonObject, fallback: string): string {
  return readOptionalString(record, 'id')
    ?? readOptionalString(record, 'relationshipId')
    ?? readOptionalString(record, 'contentHash')
    ?? fallback;
}

function readRelationshipRows(value: unknown): JsonObject[] {
  return readRecordArray(value);
}

function readTextTitleFromSummary(summary: string | null): string | null {
  const match = summary?.match(/《([^》]+)》/u);
  return match?.[1]?.trim() || null;
}

function toWorkCollectionFromRelationship(row: JsonObject, index: number): SourceDetailWorkCollection | null {
  const type = readRelationshipType(row);
  if (type !== 'text') {
    return null;
  }
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  const summary = readRelationshipSummary(row);
  const targetTextId = readScalarString(row.targetEntityId)?.replace(/^cbdb-text-/u, '') ?? null;
  const textId = readScalarString(attributes.textId)
    ?? readScalarString(attributes.textCode)
    ?? targetTextId;
  const title = readWorkTitle(attributes)
    ?? readOptionalString(presentation, 'title')
    ?? readTextTitleFromSummary(summary);
  if (!title) {
    return null;
  }
  return {
    id: readRelationshipId(row, textId ? `text-${textId}` : slug(title, String(index + 1))),
    title,
    romanizedTitle: readOptionalString(attributes, 'title')
      ?? readOptionalString(attributes, 'romanizedTitle'),
    textId,
    rowRef: readScalarString(attributes.rowRef),
    role: readOptionalString(attributes, 'role') ?? readOptionalString(attributes, 'relationRole'),
    status: normalizeWorkStatus(attributes.joinStatus ?? row.joinStatus ?? attributes.status),
  };
}

function dedupeWorks(works: SourceDetailWorkCollection[]): SourceDetailWorkCollection[] {
  const seen = new Set<string>();
  return works.filter((work) => {
    const key = work.textId ?? work.rowRef ?? work.title;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readWorldCharacterWorksFromRelationships(relationships: JsonObject[]): SourceDetailWorkCollection[] {
  return relationships
    .map(toWorkCollectionFromRelationship)
    .filter((work): work is SourceDetailWorkCollection => Boolean(work));
}

function readRelationshipLabel(row: JsonObject): string | null {
  const attributes = relationshipAttributes(row);
  const presentation = relationshipPresentation(row);
  return readOptionalString(attributes, 'officeLabel')
    ?? readOptionalString(attributes, 'statusLabel')
    ?? readOptionalString(attributes, 'entryLabel')
    ?? readOptionalString(attributes, 'addressLabel')
    ?? readOptionalString(attributes, 'placeLabel')
    ?? readOptionalString(attributes, 'sourceRelationLabelChn')
    ?? readOptionalString(attributes, 'sourceRelationLabel')
    ?? readOptionalString(attributes, 'targetLabel')
    ?? readOptionalString(attributes, 'label')
    ?? readWorkTitle(attributes)
    ?? readOptionalString(presentation, 'title');
}

function readRelationshipClues(relationships: JsonObject[]): SourceDetailRelationshipClue[] {
  const seen = new Set<string>();
  return relationships
    .map((row, index): SourceDetailRelationshipClue | null => {
      const type = readRelationshipType(row);
      if (!type || type === 'text') {
        return null;
      }
      const label = readRelationshipLabel(row);
      const summary = readRelationshipSummary(row);
      if (!label && !summary) {
        return null;
      }
      return {
        id: readRelationshipId(row, `${type}-${index + 1}`),
        type,
        label: label ?? summary ?? type,
        summary,
      };
    })
    .filter((clue): clue is SourceDetailRelationshipClue => Boolean(clue))
    .filter((clue) => {
      const key = `${clue.type}:${clue.label}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function readWorldCharacterMilestones(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacterMilestone[] {
  const biography = parseOptionalJsonObject(sourceCore?.biography);
  return readRecordArray(biography?.milestones)
    .map((row, index): SourceDetailWorldCharacterMilestone | null => {
      const title = readOptionalString(row, 'title') ?? readOptionalString(row, 'summary');
      if (!title) {
        return null;
      }
      const sequence = readFiniteNumber(row.sequence);
      return {
        id: readOptionalString(row, 'milestoneId')
          ?? readOptionalString(row, 'id')
          ?? slug(title, String(index + 1)),
        title,
        summary: readOptionalString(row, 'summary'),
        sequence,
      };
    })
    .filter((milestone): milestone is SourceDetailWorldCharacterMilestone => Boolean(milestone))
    .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
}

function readWorldCharacterRelationshipNotes(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacterRelationshipNote[] {
  return readRecordArray(sourceCore?.relationships)
    .map((row, index): SourceDetailWorldCharacterRelationshipNote | null => {
      const summary = readOptionalString(row, 'summary');
      const type = readOptionalString(row, 'relationType')
        ?? readOptionalString(row, 'type');
      if (!summary || !type) {
        return null;
      }
      const targetRef = readOptionalString(row, 'targetRef');
      return {
        id: readOptionalString(row, 'id')
          ?? (targetRef ? `${type}-${targetRef}` : null)
          ?? `${type}-${index + 1}`,
        type,
        targetRef,
        summary,
      };
    })
    .filter((note): note is SourceDetailWorldCharacterRelationshipNote => Boolean(note))
    .slice(0, 12);
}

function readWorldCharacterInteraction(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacterInteraction | null {
  const interaction = parseOptionalJsonObject(sourceCore?.interactionProfile)
    ?? parseOptionalJsonObject(sourceCore?.interaction);
  if (!interaction) {
    return null;
  }
  const profile = {
    tone: readOptionalString(interaction, 'tone'),
    cadence: readOptionalString(interaction, 'cadence'),
    scenario: readOptionalString(interaction, 'scenario'),
    greeting: readOptionalString(interaction, 'greeting'),
  };
  return Object.values(profile).some(Boolean) ? profile : null;
}

function appendUnique(target: string[], values: readonly string[]) {
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !target.includes(normalized)) {
      target.push(normalized);
    }
  }
}

function readWorldCharacterConversationAnchors(sourceCore: JsonObject | null | undefined): string[] {
  const interaction = parseOptionalJsonObject(sourceCore?.interactionProfile)
    ?? parseOptionalJsonObject(sourceCore?.interaction);
  const knowledge = parseOptionalJsonObject(sourceCore?.knowledge);
  const anchors: string[] = [];
  appendUnique(anchors, readStringArray(interaction?.greetingVariants));
  appendUnique(anchors, readStringArray(interaction?.dialogueExemplars));
  appendUnique(anchors, readStringArray(knowledge?.topics).filter((topic) => topic.length <= 72));
  appendUnique(anchors, readStringArray(knowledge?.constraints));
  return anchors.slice(0, 10);
}

function readWorldCharacter(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacter | null {
  if (!sourceCore) {
    return null;
  }
  const placement = parseOptionalJsonObject(sourceCore.placement);
  const worldCharacter: SourceDetailWorldCharacter = {
    role: readOptionalString(placement, 'role'),
    faction: readOptionalString(placement, 'faction'),
    rank: readOptionalString(placement, 'rank'),
    sceneRefs: readStringArray(placement?.sceneRefs),
    milestones: readWorldCharacterMilestones(sourceCore),
    relationshipNotes: readWorldCharacterRelationshipNotes(sourceCore),
    conversationAnchors: readWorldCharacterConversationAnchors(sourceCore),
    interaction: readWorldCharacterInteraction(sourceCore),
  };
  const hasData = Boolean(
    worldCharacter.role
      || worldCharacter.faction
      || worldCharacter.rank
      || worldCharacter.sceneRefs.length
      || worldCharacter.milestones.length
      || worldCharacter.relationshipNotes.length
      || worldCharacter.conversationAnchors.length
      || worldCharacter.interaction,
  );
  return hasData ? worldCharacter : null;
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
  const relationships = readRelationshipRows(raw.relationships);
  const works = sourceKind === 'worldCharacter'
    ? dedupeWorks([
        ...readWorldCharacterWorks(sourceRecord),
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

  return {
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
    sourceContentHash,
    runtimeSourceRef: (
      (typeof raw.runtimeSourceRef === 'string' ? raw.runtimeSourceRef.trim() : '')
      || null
    ),
    sourceRef,
    entity: readSourceDetailEntity(raw.entity),
    worldCharacter: sourceKind === 'worldCharacter' ? readWorldCharacter(sourceRecord) : null,
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
