import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';
import { projectAppsPanel } from '../src/shell/renderer/features/apps/apps-panel-projection.js';

function registration(
  overrides: Partial<LocalDevelopmentRegistration> = {},
): LocalDevelopmentRegistration {
  return {
    selector: 'dev-project-example',
    appId: 'example.local-app',
    displayName: 'Example Local App',
    canonicalProjectRoot: '/projects/example',
    shell: 'electron',
    appAccess: ['realm.data', 'future.unknown'],
    sourceGeneration: 1,
    declarationGeneration: 2,
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

describe('Desktop Apps local-development registration projection', () => {
  it('preserves raw App Access declarations and sorts newest first', async () => {
    const older = registration({
      selector: 'dev-project-older',
      appId: 'older.local-app',
      updatedAtUnixMs: 1_721_000_000_000,
    });
    const newer = registration({
      selector: 'dev-project-newer',
      appId: 'newer.local-app',
      appAccess: [],
      updatedAtUnixMs: 1_723_000_000_000,
    });

    const projection = await projectAppsPanel({
      listRegistrations: async () => [older, newer],
      listRuns: async () => [],
    });

    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(
      projection.entries.map(({ registration: row }) => row),
      [newer, older],
    );
    assert.deepEqual(projection.entries[1]?.registration.appAccess, ['realm.data', 'future.unknown']);
  });

  it('does not require or expose package or access-decision state', async () => {
    const projection = await projectAppsPanel({
      listRegistrations: async () => [registration()],
      listRuns: async () => [],
    });

    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(Object.keys(projection.entries[0] ?? {}), ['registration', 'run']);
    assert.equal(projection.entries[0]?.run, null);
  });

  it('surfaces Runtime failure without fabricating entries', async () => {
    const projection = await projectAppsPanel({
      listRegistrations: async () => {
        throw new Error('fixed Runtime service unavailable');
      },
      listRuns: async () => [],
    });
    assert.deepEqual(projection, {
      status: 'error',
      detail: 'local-development list failed: fixed Runtime service unavailable',
    });
  });
});
