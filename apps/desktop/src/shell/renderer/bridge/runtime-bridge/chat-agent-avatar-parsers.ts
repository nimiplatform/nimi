import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type {
  DesktopAgentAvatarResourceAssetPayload,
  DesktopAgentAvatarBindingRecord,
  DesktopAgentAvatarBindingSetInput,
  DesktopAgentAvatarImportLive2dInput,
  DesktopAgentAvatarImportResult,
  DesktopAgentAvatarImportVrmInput,
  DesktopAgentAvatarResourceKind,
  DesktopAgentAvatarResourceRecord,
  DesktopAgentAvatarResourceStatus,
} from './chat-agent-avatar-types.js';

function parseFiniteInteger(value: unknown, fieldName: string, errorPrefix: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${errorPrefix}: ${fieldName} must be an integer`);
  }
  return numeric;
}

function parseAvatarResourceKind(value: unknown, errorPrefix: string): DesktopAgentAvatarResourceKind {
  const normalized = parseRequiredString(value, 'kind', errorPrefix);
  if (normalized === 'vrm' || normalized === 'live2d') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: kind is invalid`);
}

function parseAvatarResourceStatus(value: unknown, errorPrefix: string): DesktopAgentAvatarResourceStatus {
  const normalized = parseRequiredString(value, 'status', errorPrefix);
  if (normalized === 'ready' || normalized === 'invalid' || normalized === 'missing') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: status is invalid`);
}

export function parseDesktopAgentAvatarResourceRecord(value: unknown): DesktopAgentAvatarResourceRecord {
  const record = assertRecord(value, 'desktop agent avatar resource is invalid');
  return {
    resourceId: parseRequiredString(record.resourceId, 'resourceId', 'desktop agent avatar resource'),
    kind: parseAvatarResourceKind(record.kind, 'desktop agent avatar resource'),
    displayName: parseRequiredString(record.displayName, 'displayName', 'desktop agent avatar resource'),
    sourceFilename: parseRequiredString(record.sourceFilename, 'sourceFilename', 'desktop agent avatar resource'),
    storedPath: parseRequiredString(record.storedPath, 'storedPath', 'desktop agent avatar resource'),
    fileUrl: parseRequiredString(record.fileUrl, 'fileUrl', 'desktop agent avatar resource'),
    posterPath: parseOptionalString(record.posterPath) || null,
    importedAtMs: parseFiniteInteger(record.importedAtMs, 'importedAtMs', 'desktop agent avatar resource'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'desktop agent avatar resource'),
    status: parseAvatarResourceStatus(record.status, 'desktop agent avatar resource'),
  };
}

export function parseDesktopAgentAvatarResourceRecords(value: unknown): DesktopAgentAvatarResourceRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('desktop agent avatar resource list returned non-array payload');
  }
  return value.map((item) => parseDesktopAgentAvatarResourceRecord(item));
}

export function parseDesktopAgentAvatarBindingRecord(value: unknown): DesktopAgentAvatarBindingRecord {
  const record = assertRecord(value, 'desktop agent avatar binding is invalid');
  return {
    agentId: parseRequiredString(record.agentId, 'agentId', 'desktop agent avatar binding'),
    resourceId: parseRequiredString(record.resourceId, 'resourceId', 'desktop agent avatar binding'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'desktop agent avatar binding'),
  };
}

export function parseDesktopAgentAvatarResourceAssetPayload(value: unknown): DesktopAgentAvatarResourceAssetPayload {
  const record = assertRecord(value, 'desktop agent avatar asset is invalid');
  return {
    mimeType: parseRequiredString(record.mimeType, 'mimeType', 'desktop agent avatar asset'),
    base64: parseRequiredString(record.base64, 'base64', 'desktop agent avatar asset'),
  };
}

export function parseDesktopAgentAvatarImportResult(value: unknown): DesktopAgentAvatarImportResult {
  const record = assertRecord(value, 'desktop agent avatar import result is invalid');
  return {
    resource: parseDesktopAgentAvatarResourceRecord(record.resource),
    binding: record.binding == null ? null : parseDesktopAgentAvatarBindingRecord(record.binding),
  };
}

export function parseDesktopAgentAvatarImportVrmInput(input: DesktopAgentAvatarImportVrmInput): DesktopAgentAvatarImportVrmInput {
  return {
    sourcePath: parseRequiredString(input.sourcePath, 'sourcePath', 'desktop agent avatar import vrm input'),
    displayName: parseOptionalString(input.displayName) || null,
    bindAgentId: parseOptionalString(input.bindAgentId) || null,
    importedAtMs: input.importedAtMs == null
      ? null
      : parseFiniteInteger(input.importedAtMs, 'importedAtMs', 'desktop agent avatar import vrm input'),
  };
}

export function parseDesktopAgentAvatarImportLive2dInput(input: DesktopAgentAvatarImportLive2dInput): DesktopAgentAvatarImportLive2dInput {
  return {
    sourcePath: parseRequiredString(input.sourcePath, 'sourcePath', 'desktop agent avatar import live2d input'),
    displayName: parseOptionalString(input.displayName) || null,
    bindAgentId: parseOptionalString(input.bindAgentId) || null,
    importedAtMs: input.importedAtMs == null
      ? null
      : parseFiniteInteger(input.importedAtMs, 'importedAtMs', 'desktop agent avatar import live2d input'),
  };
}

export function parseDesktopAgentAvatarBindingSetInput(input: DesktopAgentAvatarBindingSetInput): DesktopAgentAvatarBindingSetInput {
  return {
    agentId: parseRequiredString(input.agentId, 'agentId', 'desktop agent avatar binding input'),
    resourceId: parseRequiredString(input.resourceId, 'resourceId', 'desktop agent avatar binding input'),
    updatedAtMs: parseFiniteInteger(input.updatedAtMs, 'updatedAtMs', 'desktop agent avatar binding input'),
  };
}
