import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NimiAppClient,
  type NimiAppInventoryEntry,
  type NimiAppRow,
  type NimiAppStatus,
  type NimiAppTransport,
} from '@nimiplatform/sdk/app';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import type { NimiRuntimeAppOpenProjection } from '@nimiplatform/sdk/runtime';

import {
  appLaunchScopeRef,
  routeCardAction,
  type DesktopAppsOpenFlowEvent,
} from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import { projectAppsPanel } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import type {
  DesktopAppLifecycleBridge,
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppStorageProjection,
} from '../src/shell/renderer/features/apps/apps-lifecycle-bridge.js';

describe('Desktop Apps controller discovery proof', () => {
  it('requires catalog present and local absent for admitted catalog discovery proof', async () => {
    const catalogOnly = inventoryEntry(buildRow('community.catalog', 'Catalog App'));
    const accountOnly = inventoryEntry(buildRow('account.only', 'Account Only'), {
      sources: {
        catalog: { status: 'absent' },
        account: {
          status: 'present',
          value: {
            appId: 'account.only',
            accountState: 'verified',
            installState: 'not-installed',
            dataPolicy: 'account-bound',
          },
        },
      },
    });
    const localAdoption = inventoryEntry(buildRow('local.only', 'Local Only'), {
      trustTier: 'local-explicit',
      sources: {
        catalog: { status: 'absent' },
        local: {
          status: 'present',
          value: {
            appId: 'local.only',
            rootPath: '/local/only',
            manifestPath: '/local/only/nimi.app.yaml',
            displayName: 'Local Only',
            version: '1.0.0',
            entryRef: 'app://local.only/main',
            permissionScopeRef: 'permission-scope:local.only',
            storagePolicyRef: 'storage-policy:local.only',
            state: 'adopted',
            trust: 'explicit-local',
          },
        },
      },
    });
    const catalogAndLocal = inventoryEntry(buildRow('catalog.local', 'Catalog Local'), {
      sources: {
        local: {
          status: 'present',
          value: {
            appId: 'catalog.local',
            rootPath: '/local/catalog',
            manifestPath: '/local/catalog/nimi.app.yaml',
            displayName: 'Catalog Local',
            version: '1.0.0',
            entryRef: 'app://catalog.local/main',
            permissionScopeRef: 'permission-scope:catalog.local',
            storagePolicyRef: 'storage-policy:catalog.local',
            state: 'adopted',
            trust: 'explicit-local',
          },
        },
      },
    });
    const sandboxDeveloperCatalog = inventoryEntry(buildRow('community.sandbox', 'Sandbox App', 'developer-only'));

    const projection = await projectAppsPanel(makeClient({
      list: [catalogOnly, accountOnly, localAdoption, catalogAndLocal, sandboxDeveloperCatalog],
    }));
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;

    const proofById = new Map(projection.entries.map((entry) => [
      entry.app.appId,
      entry.catalogDiscoveryProof,
    ]));
    assert.deepEqual(proofById.get('community.catalog'), {
      admittedCatalogDiscovery: true,
      ordinaryVisibility: 'ordinary-visible',
      required: { catalog: 'present', ordinaryVisibility: 'ordinary-visible', local: 'absent' },
      sources: { catalog: 'present', account: 'absent', local: 'absent' },
    });
    assert.equal(proofById.get('account.only')?.admittedCatalogDiscovery, false);
    assert.equal(proofById.get('local.only')?.admittedCatalogDiscovery, false);
    assert.equal(proofById.get('catalog.local')?.admittedCatalogDiscovery, false);
    assert.equal(proofById.get('community.sandbox')?.ordinaryVisibility, 'developer-only');
    assert.equal(proofById.get('community.sandbox')?.admittedCatalogDiscovery, false);
  });
});

describe('Desktop Apps card actions', () => {
  for (const [action, method, reasonCode] of [
    ['install', 'install', 'RUNTIME_APP_INSTALL_DIGEST_MISMATCH'],
    ['update', 'update', 'RUNTIME_APP_INSTALL_STORAGE_VIOLATION'],
    ['uninstall', 'uninstall', 'RUNTIME_APP_PERMISSION_PENDING'],
    ['repair', 'healthRepair', 'RUNTIME_APP_INSTALL_RUNTIME_UNAVAILABLE'],
  ] as const) {
    it(`surfaces typed ${reasonCode} errors from lifecycle.${method}`, async () => {
      const lifecycle = recordingLifecycle({
        [method]: async () => {
          throw createNimiError({
            message: `${reasonCode} failure`,
            reasonCode,
            actionHint: 'check_runtime_app_lifecycle',
            source: 'runtime',
            details: { cause: 'typed failure detail' },
          });
        },
      });

      await assert.rejects(
        () => routeCardAction(lifecycle, 'community.catalog', action, {
          appClient: makeClient(),
        }),
        (error: unknown) => {
          assert.equal((error as { reasonCode?: string }).reasonCode, reasonCode);
          assert.equal((error as { details?: { cause?: string } }).details?.cause, 'typed failure detail');
          return true;
        },
      );
    });
  }

  it('records AIConfig failure as the open blocking layer before Runtime open', async () => {
    const events: DesktopAppsOpenFlowEvent[] = [];
    const lifecycle = recordingLifecycle();

    await assert.rejects(
      () => routeCardAction(lifecycle, 'community.catalog', 'open', {
        appClient: makeClient(),
        recordOpenFlowEvent: (event) => events.push(event),
        ensureAIConfig: async () => {
          throw createNimiError({
            message: 'profile setup required',
            reasonCode: 'SDK_APP_AI_CONFIG_SETUP_REQUIRED',
            actionHint: 'open_app_ai_profile_repair_surface',
            source: 'sdk',
          });
        },
      }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_APP_AI_CONFIG_SETUP_REQUIRED',
    );

    assert.deepEqual(events, [
      { appId: 'community.catalog', step: 'ai-config', status: 'started' },
      {
        appId: 'community.catalog',
        step: 'ai-config',
        status: 'failed',
        source: 'sdk',
        reasonCode: 'SDK_APP_AI_CONFIG_SETUP_REQUIRED',
      },
    ]);
  });

  it('records protected lifecycle open failures as Runtime launch-resolution', async () => {
    const runtimeEvents: DesktopAppsOpenFlowEvent[] = [];
    const runtimeFailure = recordingLifecycle({
      open: async () => {
        throw createNimiError({
          message: 'permission pending',
          reasonCode: 'RUNTIME_APP_OPEN_PERMISSION_PENDING',
          actionHint: 'complete_permission_review',
          source: 'runtime',
        });
      },
    });

    await assert.rejects(() => routeCardAction(runtimeFailure, 'community.catalog', 'open', {
      appClient: makeClient(),
      recordOpenFlowEvent: (event) => runtimeEvents.push(event),
      ensureAIConfig: async (input) => ({
        outcome: 'already-initialized' as const,
        scopeRef: { kind: 'app' as const, ownerId: input.appId },
        config: aiConfig(input.appId),
      }),
    }));
    assert.deepEqual(runtimeEvents, [
      { appId: 'community.catalog', step: 'ai-config', status: 'started' },
      { appId: 'community.catalog', step: 'ai-config', status: 'succeeded' },
      { appId: 'community.catalog', step: 'runtime-launch-resolution', status: 'started' },
      {
        appId: 'community.catalog',
        step: 'runtime-launch-resolution',
        status: 'failed',
        source: 'runtime',
        reasonCode: 'RUNTIME_APP_OPEN_PERMISSION_PENDING',
      },
    ]);

    const desktopEvents: DesktopAppsOpenFlowEvent[] = [];
    const desktopFailure = recordingLifecycle({
      open: async () => {
        throw createNimiError({
          message: 'host window failed',
          reasonCode: 'DESKTOP_INSTALLED_APP_HOST_WINDOW_FAILED',
          actionHint: 'check_desktop_installed_app_host',
          source: 'sdk',
        });
      },
    });
    await assert.rejects(() => routeCardAction(desktopFailure, 'community.catalog', 'open', {
      appClient: makeClient(),
      recordOpenFlowEvent: (event) => desktopEvents.push(event),
      ensureAIConfig: async (input) => ({
        outcome: 'already-initialized' as const,
        scopeRef: { kind: 'app' as const, ownerId: input.appId },
        config: aiConfig(input.appId),
      }),
    }));
    assert.deepEqual(desktopEvents, [
      { appId: 'community.catalog', step: 'ai-config', status: 'started' },
      { appId: 'community.catalog', step: 'ai-config', status: 'succeeded' },
      { appId: 'community.catalog', step: 'runtime-launch-resolution', status: 'started' },
      {
        appId: 'community.catalog',
        step: 'runtime-launch-resolution',
        status: 'failed',
        source: 'sdk',
        reasonCode: 'DESKTOP_INSTALLED_APP_HOST_WINDOW_FAILED',
      },
    ]);
  });

  it('records successful open as AIConfig then protected Runtime launch-resolution', async () => {
    const events: DesktopAppsOpenFlowEvent[] = [];
    const lifecycle = recordingLifecycle();
    await routeCardAction(lifecycle, 'community.catalog', 'open', {
      appClient: makeClient(),
      recordOpenFlowEvent: (event) => events.push(event),
      ensureAIConfig: async (input) => ({
        outcome: 'already-initialized' as const,
        scopeRef: { kind: 'app' as const, ownerId: input.appId },
        config: aiConfig(input.appId),
      }),
    });

    assert.deepEqual(events, [
      { appId: 'community.catalog', step: 'ai-config', status: 'started' },
      { appId: 'community.catalog', step: 'ai-config', status: 'succeeded' },
      { appId: 'community.catalog', step: 'runtime-launch-resolution', status: 'started' },
      { appId: 'community.catalog', step: 'runtime-launch-resolution', status: 'succeeded' },
    ]);
  });
});

function buildRow(
  appId = 'community.catalog',
  displayName = 'Catalog App',
  ordinaryVisibility: NimiAppRow['ordinaryVisibility'] = 'ordinary-visible',
): NimiAppRow {
  return {
    appId,
    appKind: 'nimi-app',
    displayName,
    trustTier: 'nimi-community',
    ordinaryVisibility,
    publisher: 'Nimi',
    aiProfileSelectionRef: 'local-standard',
    capabilitySet: ['text.generate'],
    releaseDescriptorRef: `${appId}.0.1.0`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-033',
  };
}

function inventoryEntry(
  row: NimiAppRow,
  overrides: Partial<Omit<NimiAppInventoryEntry, 'sources'>> & {
    readonly sources?: Partial<NimiAppInventoryEntry['sources']>;
  } = {},
): NimiAppInventoryEntry {
  const sources: NimiAppInventoryEntry['sources'] = {
    catalog: { status: 'present', value: row },
    account: { status: 'absent' },
    local: { status: 'absent' },
    packageReadiness: { status: 'absent' },
    ...overrides.sources,
  };
  return {
    appId: row.appId,
    displayName: row.displayName,
    appKind: row.appKind,
    publisher: row.publisher,
    aiProfileSelectionRef: row.aiProfileSelectionRef,
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    trustTier: row.trustTier,
    capabilitySet: [...row.capabilitySet],
    installState: 'not-installed',
    openReadiness: 'install-required',
    activeJobs: [],
    nextActions: ['install'],
    ...overrides,
    sources,
  };
}

function makeClient(behavior: {
  readonly list?: readonly NimiAppInventoryEntry[];
  readonly status?: NimiAppStatus;
} = {}): NimiAppClient {
  const transport: NimiAppTransport = {
    async list() {
      return behavior.list ?? [inventoryEntry(buildRow())];
    },
    async get(appId: string) {
      const rows = await this.list();
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) throw new Error(`missing ${appId}`);
      return row;
    },
    async status(appId: string) {
      return behavior.status ?? { appId, launchReadiness: 'ready' };
    },
  };
  return new NimiAppClient(transport);
}

function aiConfig(appId: string): NimiAIConfig {
  return {
    scopeRef: { kind: 'app', ownerId: appId },
    capabilities: {
      targetRefs: {},
      selectedParams: {},
    },
    profileOrigin: {
      profileId: 'local-standard',
      title: 'Local Standard',
      appliedAt: '2026-06-30T00:00:00.000Z',
    },
  };
}

function recordingLifecycle(
  overrides: Partial<DesktopAppLifecycleBridge> = {},
): DesktopAppLifecycleBridge {
  const installStorage = {
    appRoot: '/data/apps/community.catalog',
    releaseRoot: '/data/apps/community.catalog/releases/0.1.0',
    durableDataRoot: '/data/apps/community.catalog/data',
    cacheRoot: '/data/apps/community.catalog/cache',
    tempRoot: '/data/apps/community.catalog/tmp',
  };
  const job: NimiRuntimeAppInstallJob = {
    jobId: 'job-1',
    appId: 'community.catalog',
    kind: 'install',
    releaseDescriptorRef: 'community.catalog.0.1.0',
    installedVersion: '0.1.0',
    state: 'installed',
    phase: 'installed',
    sourceKind: 'external_artifact',
    artifactBytes: 1024,
    storage: installStorage,
    retryable: false,
  };
  const storage: NimiRuntimeAppStorageProjection = {
    appId: 'community.catalog',
    state: 'ready',
    appRoot: installStorage.appRoot,
    activeReleaseRoot: installStorage.releaseRoot,
    durableDataRoot: installStorage.durableDataRoot,
    cacheRoot: installStorage.cacheRoot,
    tempRoot: installStorage.tempRoot,
    activeVersion: '0.1.0',
    storagePolicyRef: 'nimi-data-app-roots',
  };
  const launched: NimiRuntimeAppOpenProjection = {
    appId: 'community.catalog',
    state: 'launched',
    reachedStep: 'launch',
    launched: true,
    activeVersion: '0.1.0',
    scope: appLaunchScopeRef('community.catalog'),
    reasonCode: ReasonCode.ACTION_EXECUTED,
    releaseDescriptorRef: 'community.catalog.0.1.0',
    launchNonce: 'nonce-1',
    runtimeEntryRef: 'dist/index.html',
    activeReleaseRoot: '/data/apps/community.catalog/releases/0.1.0',
    storage: installStorage,
    shellCapabilitySetRef: 'installed-nimi-app-standard-shell-v1',
    callerMode: 'desktop-launched-nimi-app',
    digestVerificationState: 'digest-verified',
  };
  const bridge: DesktopAppLifecycleBridge = {
    async install() { return job; },
    async adoptLocal() { throw new Error('not used'); },
    async removeLocalAdoption() { throw new Error('not used'); },
    async uninstall() {
      return {
        appId: 'community.catalog',
        releaseRemoved: true,
        durableDataRemoved: false,
        storage: installStorage,
        job: { ...job, kind: 'uninstall', state: 'uninstalled', phase: 'uninstalled' },
      };
    },
    async getJob() { return job; },
    async listJobs() { return []; },
    async storage() { return storage; },
    async watchJobEvents() {
      return {
        async *[Symbol.asyncIterator]() {
          yield { sequence: 1, job };
        },
      };
    },
    async update() { return { ...job, kind: 'update' }; },
    async healthRepair() { return { ...job, kind: 'repair' }; },
    async open() { return launched; },
  };
  return { ...bridge, ...overrides };
}
