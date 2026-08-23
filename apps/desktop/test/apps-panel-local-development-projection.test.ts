import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createNimiCloudAIConfigCapabilityIntent,
  type NimiAIConfigSnapshot,
} from '@nimiplatform/sdk/ai';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';
import {
  applyAppsPanelAIConfigAcknowledgement,
  createAppsPanelProjectionReloader,
} from '../src/shell/renderer/features/apps/apps-panel-controller.js';
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
    aiConfigAllowedRoutes: ['local', 'cloud'],
    sourceGeneration: 1,
    declarationGeneration: 2,
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

function unconfiguredSnapshot(): NimiAIConfigSnapshot {
  return { config: null, revision: '0', effectiveSelections: [] };
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
          config: {
            owner: { owner: { oneofKind: 'app', app: { appId } } },
            capabilities: [{
              capabilityContract: 'text.generate',
              requiredFeatures: [],
              route: { oneofKind: 'local', local: {} },
            }, createNimiCloudAIConfigCapabilityIntent({
              capabilityContract: 'image.generate', connectorRef: 'connector:image',
              implementation: { implementationId: 'provider', driverId: 'driver', driverDialect: 'provider' },
              providerModelTarget: {
                provider: 'provider', providerModelId: 'image-1', remoteModelCatalogId: 'catalog:image-1',
              },
            })],
          },
          revision: '1',
          effectiveSelections: [
            { capabilityContract: 'text.generate', state: 'ready', resource: null, reasons: [] },
            { capabilityContract: 'image.generate', state: 'blocked', resource: null, reasons: ['AI_CONNECTOR_DISABLED'] },
          ],
        };
      },
    });
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.deepEqual(reads, ['example.local-app']);
    assert.deepEqual(projection.entries[0]?.aiConfigSummary, {
      routePosture: 'partial-mixed',
      healthPosture: 'blocked',
      intentCount: 2,
      total: 9,
      blockedCount: 1,
      localCount: 1,
      cloudCount: 1,
    });
  });

  it('keeps AIConfig refresh single-flight while lifecycle refresh commits independently', async () => {
    let resolveAIConfig!: (value: NimiAIConfigSnapshot) => void;
    const pendingAIConfig = new Promise<NimiAIConfigSnapshot>((resolve) => { resolveAIConfig = resolve; });
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

    resolveAIConfig(unconfiguredSnapshot());
    await initialAIRefresh;
    const refreshedProjection = current as DesktopAppsPanelProjection | null;
    assert.equal(refreshedProjection?.status, 'loaded');
    if (refreshedProjection?.status === 'loaded') {
      assert.equal(refreshedProjection.entries[0]?.aiConfigSummary?.routePosture, 'unconfigured');
      assert.equal(refreshedProjection.entries[0]?.aiConfigSummary?.healthPosture, 'healthy');
    }
    reloader.dispose();
  });

  it('applies mutation acknowledgement route facts before an effective refresh', () => {
    const row = registration({ appAccess: ['runtime.consume'] });
    const current: DesktopAppsPanelProjection = {
      status: 'loaded',
      entries: [{
        registration: row,
        run: null,
        aiConfigSummary: {
          routePosture: 'partial-local', healthPosture: 'healthy', intentCount: 1, total: 9,
          blockedCount: 0, localCount: 1, cloudCount: 0,
        },
      }],
    };
    const cloud = createNimiCloudAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      connectorRef: 'connector:text',
      implementation: { implementationId: 'provider', driverId: 'driver', driverDialect: 'provider' },
      providerModelTarget: {
        provider: 'provider', providerModelId: 'text-1', remoteModelCatalogId: 'catalog:text-1',
      },
    });

    const acknowledged = applyAppsPanelAIConfigAcknowledgement(current, row.appId, {
      outcome: 'conflict',
      config: { capabilities: [cloud] },
      revision: '2',
      reasonCode: 'AI_CONFIG_REVISION_CONFLICT',
    });

    assert.equal(acknowledged?.status, 'loaded');
    if (acknowledged?.status !== 'loaded') return;
    assert.deepEqual(acknowledged.entries[0]?.aiConfigSummary, {
      routePosture: 'partial-cloud',
      healthPosture: 'unavailable',
      intentCount: 1,
      total: 9,
      blockedCount: 0,
      localCount: 0,
      cloudCount: 1,
    });
  });

  it('bounds AIConfig fan-out and isolates one timed-out owner', async () => {
    const registrations = Array.from({ length: 7 }, (_value, index) => registration({
      selector: `dev-project-${index}`,
      appId: index === 0 ? 'hung.local-app' : `app-${index}.local-app`,
      appAccess: ['runtime.consume'],
      updatedAtUnixMs: 1_723_000_000_000 - index,
    }));
    let active = 0;
    let maximumActive = 0;
    const projection = await projectAppsPanel({
      listRegistrations: async () => registrations,
      listRuns: async () => [],
      readAppAIConfig: async (appId, options) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (appId === 'hung.local-app') {
          return await new Promise<NimiAIConfigSnapshot>((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              active -= 1;
              reject(new Error('timed out'));
            }, { once: true });
          });
        }
        return await new Promise<NimiAIConfigSnapshot>((resolve) => {
          setTimeout(() => {
            active -= 1;
            resolve(unconfiguredSnapshot());
          }, 1);
        });
      },
    }, { aiConfigReadTimeoutMs: 20 });

    assert.equal(projection.status, 'loaded');
    assert.ok(maximumActive <= 4, `maximum active AIConfig reads = ${maximumActive}`);
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries.length, registrations.length);
    assert.equal(projection.entries[0]?.aiConfigSummary?.healthPosture, 'unavailable');
    assert.equal(projection.entries[1]?.aiConfigSummary?.healthPosture, 'healthy');
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
