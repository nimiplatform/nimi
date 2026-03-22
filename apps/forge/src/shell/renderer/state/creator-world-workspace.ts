import type {
  WorldStudioSnapshotPatch,
  WorldStudioWorkspaceSnapshot,
} from '@world-engine/contracts.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import { asRecord } from '@nimiplatform/sdk/mod';

type LegacyWorkspaceSnapshotRecord = Partial<WorldStudioWorkspaceSnapshot> & {
  worldStateDraft?: unknown;
  workspaceVersion?: unknown;
};

export type ForgeWorkspaceSnapshot = Omit<
  WorldStudioWorkspaceSnapshot,
  'worldPatch' | 'editorSnapshotVersion'
> & {
  worldStateDraft: JsonObject;
  workspaceVersion: string;
};

export type ForgeWorkspacePatch = Omit<
  WorldStudioSnapshotPatch,
  'worldPatch' | 'editorSnapshotVersion'
> & {
  worldStateDraft?: JsonObject;
  workspaceVersion?: string;
};

export function readStoredWorldStateDraft(snapshot: LegacyWorkspaceSnapshotRecord): JsonObject {
  return asRecord(snapshot.worldStateDraft);
}

export function readStoredWorkspaceVersion(snapshot: LegacyWorkspaceSnapshotRecord): string {
  const value = snapshot.workspaceVersion;
  return typeof value === 'string' ? value : String(value || '');
}

export function toForgeWorkspaceSnapshot(
  snapshot: WorldStudioWorkspaceSnapshot,
): ForgeWorkspaceSnapshot {
  const {
    worldPatch: _worldPatch,
    editorSnapshotVersion: _editorSnapshotVersion,
    ...rest
  } = snapshot;

  return {
    ...rest,
    worldStateDraft: asRecord(snapshot.worldPatch),
    workspaceVersion: String(snapshot.editorSnapshotVersion || ''),
  };
}

export function toWorldStudioWorkspaceSnapshot(
  snapshot: ForgeWorkspaceSnapshot,
): WorldStudioWorkspaceSnapshot {
  const {
    worldStateDraft,
    workspaceVersion,
    ...rest
  } = snapshot;

  return {
    ...rest,
    worldPatch: worldStateDraft,
    editorSnapshotVersion: workspaceVersion,
  };
}

export function toForgeWorkspacePatch(
  patch: WorldStudioSnapshotPatch,
): ForgeWorkspacePatch {
  const {
    worldPatch,
    editorSnapshotVersion,
    ...rest
  } = patch;

  return {
    ...rest,
    ...(worldPatch && typeof worldPatch === 'object' ? { worldStateDraft: asRecord(worldPatch) } : {}),
    ...(typeof editorSnapshotVersion === 'string'
      ? { workspaceVersion: editorSnapshotVersion }
      : {}),
  };
}

export function toWorldStudioWorkspacePatch(
  patch: ForgeWorkspacePatch,
): WorldStudioSnapshotPatch {
  const {
    worldStateDraft,
    workspaceVersion,
    ...rest
  } = patch;

  const nextPatch: WorldStudioSnapshotPatch = {
    ...rest,
  };

  if (worldStateDraft) {
    nextPatch.worldPatch = worldStateDraft;
  }

  if (typeof workspaceVersion === 'string') {
    nextPatch.editorSnapshotVersion = workspaceVersion;
  }

  return nextPatch;
}

export function toPersistedForgeWorkspaceSnapshot(
  snapshot: WorldStudioWorkspaceSnapshot & {
    worldPatchText?: string;
    worldviewPatchText?: string;
    eventsText?: string;
    lorebooksText?: string;
  },
) {
  const {
    worldPatch: _worldPatch,
    editorSnapshotVersion: _editorSnapshotVersion,
    worldPatchText: _worldPatchText,
    worldviewPatchText: _worldviewPatchText,
    eventsText: _eventsText,
    lorebooksText: _lorebooksText,
    ...rest
  } = snapshot;

  return {
    ...rest,
    worldStateDraft: asRecord(snapshot.worldPatch),
    workspaceVersion: String(snapshot.editorSnapshotVersion || ''),
  };
}
