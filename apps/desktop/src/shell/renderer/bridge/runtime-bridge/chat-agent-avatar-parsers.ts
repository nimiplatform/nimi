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

function validateLocalAgentRef(ownerUserId: string, realmAgentId: string, localAgentRef: string, errorPrefix: string): void {
  if (localAgentRef === realmAgentId) {
    throw new Error(`${errorPrefix}: localAgentRef must not be a bare realmAgentId`);
  }
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error(`${errorPrefix}: localAgentRef must start with local-agent:`);
  }
  if (localAgentRef !== `local-agent:${ownerUserId}:${realmAgentId}`) {
    throw new Error(`${errorPrefix}: localAgentRef must equal local-agent:\${ownerUserId}:\${realmAgentId}`);
  }
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
  const ownerUserId = parseRequiredString(record.ownerUserId, 'ownerUserId', 'desktop agent avatar binding');
  const realmAgentId = parseRequiredString(record.realmAgentId, 'realmAgentId', 'desktop agent avatar binding');
  const localAgentRef = parseRequiredString(record.localAgentRef, 'localAgentRef', 'desktop agent avatar binding');
  validateLocalAgentRef(ownerUserId, realmAgentId, localAgentRef, 'desktop agent avatar binding');
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef,
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
  const bindOwnerUserId = parseOptionalString(input.bindOwnerUserId) || null;
  const bindRealmAgentId = parseOptionalString(input.bindRealmAgentId) || null;
  const bindLocalAgentRef = parseOptionalString(input.bindLocalAgentRef) || null;
  if (bindOwnerUserId || bindRealmAgentId || bindLocalAgentRef) {
    if (!bindOwnerUserId || !bindRealmAgentId || !bindLocalAgentRef) {
      throw new Error('desktop agent avatar import vrm input: bindOwnerUserId, bindRealmAgentId, and bindLocalAgentRef are required together');
    }
    validateLocalAgentRef(bindOwnerUserId, bindRealmAgentId, bindLocalAgentRef, 'desktop agent avatar import vrm input');
  }
  return {
    sourcePath: parseRequiredString(input.sourcePath, 'sourcePath', 'desktop agent avatar import vrm input'),
    displayName: parseOptionalString(input.displayName) || null,
    bindOwnerUserId,
    bindRealmAgentId,
    bindLocalAgentRef,
    importedAtMs: input.importedAtMs == null
      ? null
      : parseFiniteInteger(input.importedAtMs, 'importedAtMs', 'desktop agent avatar import vrm input'),
  };
}

export function parseDesktopAgentAvatarImportLive2dInput(input: DesktopAgentAvatarImportLive2dInput): DesktopAgentAvatarImportLive2dInput {
  const bindOwnerUserId = parseOptionalString(input.bindOwnerUserId) || null;
  const bindRealmAgentId = parseOptionalString(input.bindRealmAgentId) || null;
  const bindLocalAgentRef = parseOptionalString(input.bindLocalAgentRef) || null;
  if (bindOwnerUserId || bindRealmAgentId || bindLocalAgentRef) {
    if (!bindOwnerUserId || !bindRealmAgentId || !bindLocalAgentRef) {
      throw new Error('desktop agent avatar import live2d input: bindOwnerUserId, bindRealmAgentId, and bindLocalAgentRef are required together');
    }
    validateLocalAgentRef(bindOwnerUserId, bindRealmAgentId, bindLocalAgentRef, 'desktop agent avatar import live2d input');
  }
  return {
    sourcePath: parseRequiredString(input.sourcePath, 'sourcePath', 'desktop agent avatar import live2d input'),
    displayName: parseOptionalString(input.displayName) || null,
    bindOwnerUserId,
    bindRealmAgentId,
    bindLocalAgentRef,
    importedAtMs: input.importedAtMs == null
      ? null
      : parseFiniteInteger(input.importedAtMs, 'importedAtMs', 'desktop agent avatar import live2d input'),
  };
}

export function parseDesktopAgentAvatarBindingSetInput(input: DesktopAgentAvatarBindingSetInput): DesktopAgentAvatarBindingSetInput {
  const ownerUserId = parseRequiredString(input.ownerUserId, 'ownerUserId', 'desktop agent avatar binding input');
  const realmAgentId = parseRequiredString(input.realmAgentId, 'realmAgentId', 'desktop agent avatar binding input');
  const localAgentRef = parseRequiredString(input.localAgentRef, 'localAgentRef', 'desktop agent avatar binding input');
  validateLocalAgentRef(ownerUserId, realmAgentId, localAgentRef, 'desktop agent avatar binding input');
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef,
    resourceId: parseRequiredString(input.resourceId, 'resourceId', 'desktop agent avatar binding input'),
    updatedAtMs: parseFiniteInteger(input.updatedAtMs, 'updatedAtMs', 'desktop agent avatar binding input'),
  };
}
