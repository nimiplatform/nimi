import {
  parseNimiRuntimeLocalAssetKindId,
  type NimiRuntimeLocalAssetKindId,
  type NimiRuntimeLocalRunnableAssetKindId,
} from './local-asset-vocabulary';

export type NimiRuntimeLocalProfileEntryKind = 'asset' | 'service' | 'node';

export interface NimiRuntimeLocalProfileEntryOverride {
  readonly entryId: string;
  readonly localAssetId: string;
}

export interface NimiRuntimeLocalProfileRequirementDescriptor {
  readonly minGpuMemoryGb?: number;
  readonly minDiskBytes?: number;
  readonly platforms?: readonly string[];
  readonly notes?: readonly string[];
}

export interface NimiRuntimeLocalProfileEntryDescriptor {
  readonly entryId: string;
  readonly kind: NimiRuntimeLocalProfileEntryKind;
  readonly title?: string;
  readonly description?: string;
  readonly capability?: NimiRuntimeLocalRunnableAssetKindId | string;
  readonly required?: boolean;
  readonly preferred?: boolean;
  readonly assetId?: string;
  readonly assetKind?: NimiRuntimeLocalAssetKindId;
  readonly engineSlot?: string;
  readonly repo?: string;
  readonly serviceId?: string;
  readonly nodeId?: string;
  readonly engine?: string;
  readonly templateId?: string;
  readonly revision?: string;
  readonly tags?: readonly string[];
}

export interface NimiRuntimeLocalProfileDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly recommended: boolean;
  readonly consumeCapabilities: readonly (NimiRuntimeLocalRunnableAssetKindId | string)[];
  readonly entries: readonly NimiRuntimeLocalProfileEntryDescriptor[];
  readonly requirements?: NimiRuntimeLocalProfileRequirementDescriptor;
}

export interface NimiRuntimeLocalProfileTargetDescriptor {
  readonly targetId: string;
  readonly targetName: string;
  readonly consumeCapabilities: readonly (NimiRuntimeLocalRunnableAssetKindId | string)[];
  readonly profiles: readonly NimiRuntimeLocalProfileDescriptor[];
}

export interface NimiRuntimeLocalProfileExecutionOptionDescriptor {
  readonly entryId: string;
  readonly kind: NimiRuntimeLocalProfileEntryKind;
  readonly capability?: NimiRuntimeLocalRunnableAssetKindId | string;
  readonly title?: string;
  readonly assetId?: string;
  readonly repo?: string;
  readonly serviceId?: string;
  readonly nodeId?: string;
  readonly engine?: string;
}

export interface NimiRuntimeLocalProfileExecutionDeclarationDescriptor {
  readonly required?: readonly NimiRuntimeLocalProfileExecutionOptionDescriptor[];
  readonly optional?: readonly NimiRuntimeLocalProfileExecutionOptionDescriptor[];
}

export interface NimiRuntimeLocalProfileExecutionBridge {
  readonly runtimeEntries?: NimiRuntimeLocalProfileExecutionDeclarationDescriptor;
  readonly assets: readonly NimiRuntimeLocalProfileEntryDescriptor[];
}

export function normalizeNimiRuntimeLocalProfilesDeclaration(
  value: unknown,
): NimiRuntimeLocalProfileDescriptor[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row): NimiRuntimeLocalProfileDescriptor | null => {
      const record = asRecord(row);
      const id = normalizeText(record.id);
      const title = normalizeText(record.title);
      if (!id || !title) {
        return null;
      }
      const requirements = asRecord(record.requirements);
      return {
        id,
        title,
        description: normalizeText(record.description) || undefined,
        recommended: typeof record.recommended === 'boolean' ? record.recommended : false,
        consumeCapabilities: textList(record.consumeCapabilities),
        entries: (Array.isArray(record.entries) ? record.entries : [])
          .map((entry) => normalizeNimiRuntimeLocalProfileEntry(entry))
          .filter((entry): entry is NimiRuntimeLocalProfileEntryDescriptor => Boolean(entry)),
        requirements: Object.keys(requirements).length > 0
          ? {
            minGpuMemoryGb: finiteNumber(requirements.minGpuMemoryGb),
            minDiskBytes: finiteNumber(requirements.minDiskBytes),
            platforms: textList(requirements.platforms),
            notes: textList(requirements.notes),
          }
          : undefined,
      };
    })
    .filter((profile): profile is NimiRuntimeLocalProfileDescriptor => profile !== null);
}

export function findNimiRuntimeLocalProfileById(
  profiles: readonly NimiRuntimeLocalProfileDescriptor[],
  profileId: string,
): NimiRuntimeLocalProfileDescriptor | null {
  const normalizedProfileId = normalizeText(profileId);
  if (!normalizedProfileId) {
    return null;
  }
  return profiles.find((profile) => profile.id === normalizedProfileId) || null;
}

export function nimiRuntimeLocalProfileSupportsCapability(
  profile: NimiRuntimeLocalProfileDescriptor,
  capability?: string,
): boolean {
  const normalizedCapability = normalizeText(capability);
  if (!normalizedCapability) {
    return true;
  }
  if (profile.consumeCapabilities.includes(normalizedCapability)) {
    return true;
  }
  return profile.entries.some((entry) => normalizeText(entry.capability) === normalizedCapability);
}

export function bridgeNimiRuntimeLocalProfile(
  profile: NimiRuntimeLocalProfileDescriptor,
  capability?: string,
): NimiRuntimeLocalProfileExecutionBridge {
  const normalizedCapability = normalizeText(capability);
  const filteredEntries = profile.entries.filter((entry) => (
    !normalizedCapability
    || !normalizeText(entry.capability)
    || normalizeText(entry.capability) === normalizedCapability
  ));
  const executionEntries = filteredEntries.filter((entry) => entry.kind === 'service' || entry.kind === 'node');
  const assetEntries = filteredEntries.filter((entry) => entry.kind === 'asset');
  const required = executionEntries
    .filter((entry) => entry.required !== false)
    .map((entry) => toNimiRuntimeLocalProfileExecutionOption(entry));
  const optional = executionEntries
    .filter((entry) => entry.required === false)
    .map((entry) => toNimiRuntimeLocalProfileExecutionOption(entry));

  return {
    runtimeEntries: required.length > 0 || optional.length > 0
      ? {
        required: required.length > 0 ? required : undefined,
        optional: optional.length > 0 ? optional : undefined,
      }
      : undefined,
    assets: assetEntries,
  };
}

function normalizeNimiRuntimeLocalProfileEntry(
  value: unknown,
): NimiRuntimeLocalProfileEntryDescriptor | null {
  const record = asRecord(value);
  const kind = normalizeNimiRuntimeLocalProfileEntryKind(record.kind);
  const entryId = normalizeText(record.entryId || record.id);
  if (!kind || !entryId) {
    return null;
  }
  return {
    entryId,
    kind,
    title: normalizeText(record.title) || undefined,
    description: normalizeText(record.description) || undefined,
    capability: normalizeText(record.capability) || undefined,
    required: typeof record.required === 'boolean' ? record.required : undefined,
    preferred: typeof record.preferred === 'boolean' ? record.preferred : undefined,
    assetId: normalizeText(record.assetId) || undefined,
    assetKind: parseNimiRuntimeLocalAssetKindId(record.assetKind || record.kindHint),
    engineSlot: normalizeText(record.engineSlot) || undefined,
    repo: normalizeText(record.repo) || undefined,
    serviceId: normalizeText(record.serviceId) || undefined,
    nodeId: normalizeText(record.nodeId) || undefined,
    engine: normalizeText(record.engine) || undefined,
    templateId: normalizeText(record.templateId) || undefined,
    revision: normalizeText(record.revision) || undefined,
    tags: textList(record.tags),
  };
}

function normalizeNimiRuntimeLocalProfileEntryKind(
  value: unknown,
): NimiRuntimeLocalProfileEntryKind | null {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'asset' || normalized === 'service' || normalized === 'node') {
    return normalized;
  }
  return null;
}

function toNimiRuntimeLocalProfileExecutionOption(
  entry: NimiRuntimeLocalProfileEntryDescriptor,
): NimiRuntimeLocalProfileExecutionOptionDescriptor {
  return {
    entryId: entry.entryId,
    kind: entry.kind === 'service' ? 'service' : (entry.kind === 'node' ? 'node' : 'asset'),
    capability: entry.capability,
    title: entry.title,
    assetId: entry.assetId,
    repo: entry.repo,
    serviceId: entry.serviceId,
    nodeId: entry.nodeId,
    engine: entry.engine,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
