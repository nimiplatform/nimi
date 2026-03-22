import { describe, expect, it } from 'vitest';
import {
  readStoredWorkspaceVersion,
  readStoredWorldStateDraft,
  toForgeWorkspaceSnapshot,
  toPersistedForgeWorkspaceSnapshot,
  toWorldStudioWorkspacePatch,
} from './creator-world-workspace.js';

describe('creator-world-workspace adapter', () => {
  it('maps world-studio snapshot fields to Forge workspace semantics', () => {
    const snapshot = toForgeWorkspaceSnapshot({
      sourceText: 'hello',
      worldPatch: { name: 'Realm' },
      editorSnapshotVersion: 'workspace-v1',
    } as never);

    expect(snapshot.worldStateDraft).toEqual({ name: 'Realm' });
    expect(snapshot.workspaceVersion).toBe('workspace-v1');
  });

  it('maps Forge workspace patch fields back to world-studio snapshot fields', () => {
    const patch = toWorldStudioWorkspacePatch({
      worldStateDraft: { name: 'Realm' },
      workspaceVersion: 'workspace-v2',
      sourceText: 'updated',
    });

    expect(patch).toMatchObject({
      worldPatch: { name: 'Realm' },
      editorSnapshotVersion: 'workspace-v2',
      sourceText: 'updated',
    });
  });

  it('reads and persists Forge workspace storage keys', () => {
    const stored = {
      worldStateDraft: { name: 'Stored Realm' },
      workspaceVersion: 'workspace-v3',
      sourceText: 'stored',
    };

    expect(readStoredWorldStateDraft(stored)).toEqual({ name: 'Stored Realm' });
    expect(readStoredWorkspaceVersion(stored)).toBe('workspace-v3');
    expect(
      toPersistedForgeWorkspaceSnapshot({
        sourceText: 'stored',
        worldPatch: { name: 'Stored Realm' },
        editorSnapshotVersion: 'workspace-v3',
      } as never),
    ).toMatchObject(stored);
  });

  it('fails closed on removed storage fallback fields', () => {
    expect(
      readStoredWorldStateDraft({ worldPatch: { name: 'Legacy Realm' } } as never),
    ).toEqual({});
    expect(
      readStoredWorkspaceVersion({ editorSnapshotVersion: 'legacy-version' } as never),
    ).toBe('');
  });
});
