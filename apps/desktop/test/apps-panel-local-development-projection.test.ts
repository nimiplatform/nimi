import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';
import { createAppsPanelProjectionReloader } from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import {
  projectAppsPanel,
  type DesktopAppsPanelProjection,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';

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
    assert.deepEqual(Object.keys(projection.entries[0] ?? {}), ['registration', 'run', 'aiConfigSummary']);
    assert.equal(projection.entries[0]?.run, null);
  });

  it('aggregates each runtime.consume App through its existing canonical appId client', async () => {
    const reads: string[] = [];
    const projection = await projectAppsPanel({
      listRegistrations: async () => [registration({ appAccess: ['runtime.consume'] })],
      listRuns: async () => [],
      async readAppAIConfig(appId) {
        reads.push(appId);
        return {
          owner: { owner: { oneofKind: 'app', app: { appId } } },
          capabilities: [{
            capabilityContract: 'text.generate',
            requiredFeatures: [],
            route: { oneofKind: 'local', local: { loadoutRef: 'loadout:text' } },
          }, {
            capabilityContract: 'image.generate',
            requiredFeatures: [],
            route: {
              oneofKind: 'cloud',
              cloud: {
                implementation: { implementationId: 'provider', driverId: 'driver', driverDialect: 'provider' },
              },
            },
          }],
        };
      },
    });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(reads, ['example.local-app']);
    assert.deepEqual(projection.entries[0]?.aiConfigSummary, {
      posture: 'partial-mixed',
      configuredCount: 2,
      totalCount: 9,
      localCount: 1,
      cloudCount: 1,
    });
  });

  it('keeps AIConfig refresh single-flight while lifecycle refresh commits independently', async () => {
    let resolveAIConfig!: (value: null) => void;
    const pendingAIConfig = new Promise<null>((resolve) => { resolveAIConfig = resolve; });
    let reads = 0;
    let current: DesktopAppsPanelProjection | null = null;
    const reloader = createAppsPanelProjectionReloader({
      source: {
        listRegistrations: async () => [registration({ appAccess: ['runtime.consume'] })],
        listRuns: async () => [],
        async readAppAIConfig() {
          reads += 1;
          return pendingAIConfig;
        },
      },
      getCurrent: () => current,
      commit(next) { current = next; },
    });

    const initialAIRefresh = reloader.reload(true);
    await reloader.reload(false);
    const lifecycleProjection = current as DesktopAppsPanelProjection | null;
    assert.equal(lifecycleProjection?.status, 'loaded');
    if (lifecycleProjection?.status === 'loaded') {
      assert.equal(lifecycleProjection.entries[0]?.aiConfigSummary, null);
    }
    assert.strictEqual(reloader.reload(true), initialAIRefresh);
    assert.equal(reads, 1);

    resolveAIConfig(null);
    await initialAIRefresh;
    const refreshedProjection = current as DesktopAppsPanelProjection | null;
    assert.equal(refreshedProjection?.status, 'loaded');
    if (refreshedProjection?.status === 'loaded') {
      assert.equal(refreshedProjection.entries[0]?.aiConfigSummary?.posture, 'unconfigured');
    }
    reloader.dispose();
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
