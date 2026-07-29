import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LocalDevelopmentAuthorization } from '../src/shell/renderer/features/local-development/local-development-types.js';
import { projectAppsPanel } from '../src/shell/renderer/features/apps/apps-panel-projection.js';

function authorization(
  overrides: Partial<LocalDevelopmentAuthorization> = {},
): LocalDevelopmentAuthorization {
  return {
    selector: 'dev-project-example',
    appId: 'example.local-app',
    displayName: 'Example Local App',
    canonicalProjectRoot: 'D:\\projects\\example',
    shell: 'electron',
    accountId: 'account-current',
    permissionRequirements: [],
    persistence: 'allow-project',
    state: 'active',
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

describe('Desktop Apps current local-development projection', () => {
  it('preserves Runtime-mediated authorization rows and sorts newest first', async () => {
    const older = authorization({
      selector: 'dev-project-older',
      appId: 'older.local-app',
      updatedAtUnixMs: 1_721_000_000_000,
    });
    const newer = authorization({
      selector: 'dev-project-newer',
      appId: 'newer.local-app',
      state: 'revoked',
      updatedAtUnixMs: 1_723_000_000_000,
    });

    const projection = await projectAppsPanel({
      listAuthorizations: async () => [older, newer],
    });

    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(
      projection.entries.map(({ authorization: row }) => row),
      [newer, older],
    );
  });

  it('does not require or expose a registry, package, install, update, or repair source', async () => {
    const projection = await projectAppsPanel({
      listAuthorizations: async () => [authorization()],
    });

    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(Object.keys(projection.entries[0] ?? {}).sort(), ['authorization']);
  });

  it('surfaces the exact owner projection failure without fabricating entries', async () => {
    const projection = await projectAppsPanel({
      listAuthorizations: async () => {
        throw new Error('fixed Runtime service unavailable');
      },
    });
    assert.deepEqual(projection, {
      status: 'error',
      detail: 'local-development list failed: fixed Runtime service unavailable',
    });
  });
});
