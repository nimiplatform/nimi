import { loadLocalStorageJson, removeLocalStorageKey, saveLocalStorageJson } from '@nimiplatform/sdk/mod';
import type {
  LookdevBatch,
  LookdevCaptureState,
  LookdevPortraitBrief,
  LookdevWorldStylePack,
  LookdevWorldStyleSession,
} from './types.js';

export type PersistedLookdevWorkspace = {
  batches: LookdevBatch[];
  worldStyleSessions: Record<string, LookdevWorldStyleSession>;
  worldStylePacks: Record<string, LookdevWorldStylePack>;
  captureStates: Record<string, LookdevCaptureState>;
  portraitBriefs: Record<string, LookdevPortraitBrief>;
};

type StoredLookdevWorkspace = {
  version: 1;
  workspace: PersistedLookdevWorkspace;
};

const LOOKDEV_WORKSPACE_STORAGE_PREFIX = 'nimi:lookdev:workspace:';
const LOOKDEV_WORKSPACE_LEGACY_STORAGE_KEY = 'lookdev-workspace-formal-v8';

function createEmptyWorkspace(): PersistedLookdevWorkspace {
  return {
    batches: [],
    worldStyleSessions: {},
    worldStylePacks: {},
    captureStates: {},
    portraitBriefs: {},
  };
}

function normalizeUserId(value: string): string {
  return String(value || '').trim();
}

function storageKeyForUser(userId: string): string {
  return `${LOOKDEV_WORKSPACE_STORAGE_PREFIX}${normalizeUserId(userId)}:v1`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasCompatibleCaptureStateSnapshot(value: unknown): value is LookdevCaptureState {
  if (!isObjectRecord(value)) {
    return false;
  }
  if (value.synthesisMode !== 'interactive' && value.synthesisMode !== 'silent') {
    return false;
  }
  if (typeof value.currentBrief !== 'string') {
    return false;
  }
  if (!isObjectRecord(value.feelingAnchor) || typeof value.feelingAnchor.coreVibe !== 'string') {
    return false;
  }
  return true;
}

function hasCompatibleBatchItemSnapshot(value: unknown): boolean {
  return isObjectRecord(value) && hasCompatibleCaptureStateSnapshot(value.captureStateSnapshot);
}

function unwrapPersistedLookdevState(value: unknown): unknown {
  if (isObjectRecord(value) && isObjectRecord(value.workspace)) {
    return value.workspace;
  }
  if (isObjectRecord(value) && isObjectRecord(value.state)) {
    return value.state;
  }
  return value;
}

export function sanitizePersistedLookdevWorkspace(value: unknown): PersistedLookdevWorkspace {
  const unwrapped = unwrapPersistedLookdevState(value);
  if (!isObjectRecord(unwrapped)) {
    return createEmptyWorkspace();
  }

  return {
    batches: Array.isArray(unwrapped.batches)
      ? unwrapped.batches.filter((batch) => isObjectRecord(batch)
        && Array.isArray(batch.items)
        && batch.items.every((item) => hasCompatibleBatchItemSnapshot(item))) as LookdevBatch[]
      : [],
    worldStyleSessions: isObjectRecord(unwrapped.worldStyleSessions) ? unwrapped.worldStyleSessions as Record<string, LookdevWorldStyleSession> : {},
    worldStylePacks: isObjectRecord(unwrapped.worldStylePacks) ? unwrapped.worldStylePacks as Record<string, LookdevWorldStylePack> : {},
    captureStates: isObjectRecord(unwrapped.captureStates) ? unwrapped.captureStates as Record<string, LookdevCaptureState> : {},
    portraitBriefs: isObjectRecord(unwrapped.portraitBriefs) ? unwrapped.portraitBriefs as Record<string, LookdevPortraitBrief> : {},
  };
}

export function loadLookdevWorkspaceForUser(userId: string): PersistedLookdevWorkspace {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return createEmptyWorkspace();
  }
  const scoped = loadLocalStorageJson<StoredLookdevWorkspace | null>(
    storageKeyForUser(normalizedUserId),
    null,
    (value) => (value && typeof value === 'object' ? value as StoredLookdevWorkspace : null),
  );
  if (scoped) {
    return sanitizePersistedLookdevWorkspace(scoped);
  }
  const legacy = loadLocalStorageJson<unknown>(LOOKDEV_WORKSPACE_LEGACY_STORAGE_KEY, null);
  return sanitizePersistedLookdevWorkspace(legacy);
}

export function persistLookdevWorkspaceForUser(userId: string, workspace: PersistedLookdevWorkspace): void {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return;
  }
  saveLocalStorageJson(storageKeyForUser(normalizedUserId), {
    version: 1,
    workspace: sanitizePersistedLookdevWorkspace(workspace),
  } satisfies StoredLookdevWorkspace);
}

export function clearLookdevWorkspaceForUser(userId: string): void {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return;
  }
  removeLocalStorageKey(storageKeyForUser(normalizedUserId));
}

export function createEmptyLookdevWorkspace(): PersistedLookdevWorkspace {
  return createEmptyWorkspace();
}

export function getLookdevLegacyWorkspaceStorageKey(): string {
  return LOOKDEV_WORKSPACE_LEGACY_STORAGE_KEY;
}

export function getLookdevWorkspaceStorageKeyForUser(userId: string): string {
  return storageKeyForUser(userId);
}
