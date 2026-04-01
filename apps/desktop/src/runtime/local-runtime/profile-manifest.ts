import type {
  LocalRuntimeExecutionOptionDescriptor,
} from './types-dependencies';
import type {
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileExecutionBridge,
} from './types-profiles';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeAssetKind(value: unknown): LocalRuntimeProfileEntryDescriptor['assetKind'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'chat'
    || normalized === 'image'
    || normalized === 'video'
    || normalized === 'tts'
    || normalized === 'stt'
    || normalized === 'vae'
    || normalized === 'clip'
    || normalized === 'controlnet'
    || normalized === 'lora'
    || normalized === 'auxiliary'
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeEntryKind(value: unknown): LocalRuntimeProfileEntryDescriptor['kind'] | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'asset'
    || normalized === 'service'
    || normalized === 'node'
  ) {
    return normalized;
  }
  return null;
}

function normalizeProfileEntry(value: unknown): LocalRuntimeProfileEntryDescriptor | null {
  const record = asRecord(value);
  const kind = normalizeEntryKind(record.kind);
  const entryId = String(record.entryId || record.id || '').trim();
  if (!kind || !entryId) {
    return null;
  }
  return {
    entryId,
    kind,
    title: String(record.title || '').trim() || undefined,
    description: String(record.description || '').trim() || undefined,
    capability: String(record.capability || '').trim() || undefined,
    required: typeof record.required === 'boolean' ? Boolean(record.required) : undefined,
    preferred: typeof record.preferred === 'boolean' ? Boolean(record.preferred) : undefined,
    assetId: String(record.assetId || '').trim() || undefined,
    assetKind: normalizeAssetKind(record.assetKind || record.kindHint),
    engineSlot: String(record.engineSlot || '').trim() || undefined,
    repo: String(record.repo || '').trim() || undefined,
    serviceId: String(record.serviceId || '').trim() || undefined,
    nodeId: String(record.nodeId || '').trim() || undefined,
    engine: String(record.engine || '').trim() || undefined,
    templateId: String(record.templateId || '').trim() || undefined,
    revision: String(record.revision || '').trim() || undefined,
    tags: asStringArray(record.tags),
  };
}

export function normalizeLocalRuntimeProfilesDeclaration(value: unknown): LocalRuntimeProfileDescriptor[] {
  const rows = Array.isArray(value) ? value : [];
  const profiles = rows.map((row): LocalRuntimeProfileDescriptor | null => {
    const record = asRecord(row);
    const id = String(record.id || '').trim();
    const title = String(record.title || '').trim();
    if (!id || !title) {
      return null;
    }
    const requirements = asRecord(record.requirements);
    return {
      id,
      title,
      description: String(record.description || '').trim() || undefined,
      recommended: normalizeBoolean(record.recommended, false),
      consumeCapabilities: asStringArray(record.consumeCapabilities),
      entries: (Array.isArray(record.entries) ? record.entries : [])
        .map((entry) => normalizeProfileEntry(entry))
        .filter((entry): entry is LocalRuntimeProfileEntryDescriptor => Boolean(entry)),
      requirements: Object.keys(requirements).length > 0
        ? {
          minGpuMemoryGb: Number.isFinite(Number(requirements.minGpuMemoryGb))
            ? Number(requirements.minGpuMemoryGb)
            : undefined,
          minDiskBytes: Number.isFinite(Number(requirements.minDiskBytes))
            ? Number(requirements.minDiskBytes)
            : undefined,
          platforms: asStringArray(requirements.platforms),
          notes: asStringArray(requirements.notes),
        }
        : undefined,
    };
  });
  return profiles.filter((profile): profile is LocalRuntimeProfileDescriptor => profile !== null);
}

export function findLocalRuntimeProfileById(
  profiles: LocalRuntimeProfileDescriptor[],
  profileId: string,
): LocalRuntimeProfileDescriptor | null {
  const normalizedProfileId = String(profileId || '').trim();
  if (!normalizedProfileId) {
    return null;
  }
  return profiles.find((profile) => profile.id === normalizedProfileId) || null;
}

export function profileSupportsCapability(
  profile: LocalRuntimeProfileDescriptor,
  capability?: string,
): boolean {
  const normalizedCapability = String(capability || '').trim();
  if (!normalizedCapability) {
    return true;
  }
  if (profile.consumeCapabilities.includes(normalizedCapability)) {
    return true;
  }
  return profile.entries.some((entry) => String(entry.capability || '').trim() === normalizedCapability);
}

function toExecutionOption(entry: LocalRuntimeProfileEntryDescriptor): LocalRuntimeExecutionOptionDescriptor {
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

export function bridgeLocalRuntimeProfile(
  profile: LocalRuntimeProfileDescriptor,
  capability?: string,
): LocalRuntimeProfileExecutionBridge {
  const normalizedCapability = String(capability || '').trim();
  const filteredEntries = profile.entries.filter((entry) => (
    !normalizedCapability
    || !String(entry.capability || '').trim()
    || String(entry.capability || '').trim() === normalizedCapability
  ));
  const executionEntries = filteredEntries.filter((entry) => entry.kind === 'service' || entry.kind === 'node');
  const assetEntries = filteredEntries.filter((entry) => entry.kind === 'asset');
  const required = executionEntries
    .filter((entry) => entry.required !== false)
    .map((entry) => toExecutionOption(entry));
  const optional = executionEntries
    .filter((entry) => entry.required === false)
    .map((entry) => toExecutionOption(entry));

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
