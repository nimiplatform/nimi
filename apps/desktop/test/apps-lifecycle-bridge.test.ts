import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import type {
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppInstallJobEvent,
  NimiRuntimeAppLifecycleClient,
  NimiRuntimeAppUninstallResult,
} from '@nimiplatform/sdk/runtime';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';

import {
  asAppLifecycleNimiError,
  createDesktopAppLifecycleBridge,
  formatAppLifecycleErrorDetail,
} from '../src/shell/renderer/features/apps/apps-lifecycle-bridge';

// ---------------------------------------------------------------------------
// Typed fixtures — these are exactly what the SDK surface returns; the bridge
// must project them through unchanged.
// ---------------------------------------------------------------------------

function installJob(overrides: Partial<NimiRuntimeAppInstallJob> = {}): NimiRuntimeAppInstallJob {
  return {
    jobId: 'job-01',
    appId: 'nimi.notes',
    kind: 'install',
    releaseDescriptorRef: 'descriptor-01',
    installedVersion: '1.0.0',
    state: 'in_progress',
    phase: 'download',
    sourceKind: 'bundled',
    artifactBytes: 4096,
    storage: {
      appRoot: '/data/apps/nimi.notes',
      releaseRoot: '/data/apps/nimi.notes/releases/1.0.0',
      durableDataRoot: '/data/apps/nimi.notes/data',
      cacheRoot: '/data/apps/nimi.notes/cache',
      tempRoot: '/data/apps/nimi.notes/tmp',
    },
    retryable: false,
    ...overrides,
  };
}

const uninstallResult: NimiRuntimeAppUninstallResult = {
  appId: 'nimi.notes',
  releaseRemoved: true,
  durableDataRemoved: false,
  storage: installJob().storage,
  job: installJob({ kind: 'uninstall', state: 'uninstalled', phase: 'uninstalled' }),
};

type ModuleCall = {
  method: keyof NimiRuntimeAppLifecycleClient;
  input: unknown;
  options: unknown;
};

/** A recording stub `NimiRuntimeAppLifecycleClient` for bridge-isolation tests. */
function stubModule(
  overrides: Partial<NimiRuntimeAppLifecycleClient> = {},
): { module: NimiRuntimeAppLifecycleClient; calls: ModuleCall[] } {
  const calls: ModuleCall[] = [];
  const record = (method: keyof NimiRuntimeAppLifecycleClient) => (input: unknown, options: unknown) => {
    calls.push({ method, input, options });
  };
  const base: NimiRuntimeAppLifecycleClient = {
    async accountInventory(options) {
      record('accountInventory')({}, options);
      return { exists: false };
    },
    async adoptLocal(input, options) {
      record('adoptLocal')(input, options);
      return {
        appId: input.expectedAppId ?? 'local.notes',
        rootPath: input.rootPath,
        manifestPath: `${input.rootPath}/nimi.app.yaml`,
        displayName: 'Local Notes',
        version: '1.0.0',
        entryRef: 'app://local.notes/main',
        permissionScopeRef: 'permission-scope:local.notes',
        storagePolicyRef: 'storage-policy:local.notes',
        state: 'adopted',
        trust: 'explicit-local',
      };
    },
    async listLocalAdoptions(options) {
      record('listLocalAdoptions')({}, options);
      return [];
    },
    async removeLocalAdoption(input, options) {
      record('removeLocalAdoption')(input, options);
      return {
        appId: input.appId,
        rootPath: '/local/notes',
        manifestPath: '/local/notes/nimi.app.yaml',
        displayName: 'Local Notes',
        version: '1.0.0',
        entryRef: 'app://local.notes/main',
        permissionScopeRef: 'permission-scope:local.notes',
        storagePolicyRef: 'storage-policy:local.notes',
        state: 'removed',
        trust: 'explicit-local',
        reasonCode: ReasonCode.ACTION_EXECUTED,
      };
    },
    async install(input, options) {
      record('install')(input, options);
      return installJob();
    },
    async uninstall(input, options) {
      record('uninstall')(input, options);
      return uninstallResult;
    },
    async storage(input, options) {
      record('storage')(input, options);
      return {
        appId: 'nimi.notes',
        state: 'ready',
        appRoot: '/data/apps/nimi.notes',
        durableDataRoot: '/data/apps/nimi.notes/data',
        cacheRoot: '/data/apps/nimi.notes/cache',
        tempRoot: '/data/apps/nimi.notes/tmp',
        storagePolicyRef: 'nimi-data-app-roots',
      };
    },
    async packageReadiness(input, options) {
      record('packageReadiness')(input, options);
      return {
        appId: 'nimi.notes',
        releaseDescriptorRef: 'nimi.notes.bundled-with-nimi',
        storagePolicyRef: 'nimi-data-app-roots',
        expectedVersion: '1.0.0',
        activeVersion: '1.0.0',
        installedVersion: '1.0.0',
        verificationState: 'digest-verified',
        state: 'ready',
        reasonCode: ReasonCode.ACTION_EXECUTED,
      };
    },
    async getJob(input, options) {
      record('getJob')(input, options);
      return installJob();
    },
    async listJobs(input, options) {
      record('listJobs')(input, options);
      return [installJob()];
    },
    watchJobEvents(input, options) {
      record('watchJobEvents')(input, options);
      const frames: NimiRuntimeAppInstallJobEvent[] = [
        { sequence: 0, job: installJob() },
        { sequence: 1, job: installJob({ state: 'installed', phase: 'installed' }) },
      ];
      return {
        async *[Symbol.asyncIterator]() {
          for (const frame of frames) {
            yield frame;
          }
        },
      };
    },
    async update(input, options) {
      record('update')(input, options);
      return installJob({ kind: 'update', previousVersion: '0.9.0' });
    },
    async healthRepair(input, options) {
      record('healthRepair')(input, options);
      return installJob({ kind: 'repair' });
    },
    async open(input, options) {
      record('open')(input, options);
      return {
        appId: 'nimi.notes',
        state: 'launched',
        reachedStep: 'launch',
        launched: true,
        activeVersion: '1.0.0',
        scope: { kind: 'app', ownerId: 'nimi.notes' },
        reasonCode: ReasonCode.ACTION_EXECUTED,
      };
    },
  };
  return { module: { ...base, ...overrides }, calls };
}

// ---------------------------------------------------------------------------
// Pass-through projection
// ---------------------------------------------------------------------------

describe('createDesktopAppLifecycleBridge — typed projection pass-through', () => {
  test('install projects the SDK AppInstallJob unchanged', async () => {
    const { module, calls } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const job = await bridge.install({ appId: 'nimi.notes', confirmed: true });
    assert.deepEqual(job, installJob());
    assert.equal(calls[0]?.method, 'install');
    assert.deepEqual(calls[0]?.input, { appId: 'nimi.notes', confirmed: true });
  });

  test('adoptLocal projects the SDK local adoption unchanged', async () => {
    const { module, calls } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const adoption = await bridge.adoptLocal({
      rootPath: '/local/notes',
      expectedAppId: 'local.notes',
    });
    assert.equal(adoption.appId, 'local.notes');
    assert.equal(adoption.rootPath, '/local/notes');
    assert.equal(calls[0]?.method, 'adoptLocal');
    assert.deepEqual(calls[0]?.input, {
      rootPath: '/local/notes',
      expectedAppId: 'local.notes',
    });
  });

  test('removeLocalAdoption projects the SDK local adoption unchanged', async () => {
    const { module, calls } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const adoption = await bridge.removeLocalAdoption({
      appId: 'local.notes',
      deleteDurableDataConfirmed: false,
    });
    assert.equal(adoption.appId, 'local.notes');
    assert.equal(adoption.state, 'removed');
    assert.equal(calls[0]?.method, 'removeLocalAdoption');
    assert.deepEqual(calls[0]?.input, {
      appId: 'local.notes',
      deleteDurableDataConfirmed: false,
    });
  });

  test('uninstall projects the SDK AppUninstallResult unchanged', async () => {
    const { module } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const result = await bridge.uninstall({ appId: 'nimi.notes' });
    assert.deepEqual(result, uninstallResult);
  });

  test('update projects kind=update with previousVersion', async () => {
    const { module } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const job = await bridge.update({ appId: 'nimi.notes', confirmed: true });
    assert.equal(job.kind, 'update');
    assert.equal(job.previousVersion, '0.9.0');
  });

  test('healthRepair projects kind=repair', async () => {
    const { module } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const job = await bridge.healthRepair({ appId: 'nimi.notes', action: 'repair' });
    assert.equal(job.kind, 'repair');
  });

  test('listJobs returns the SDK job array unchanged', async () => {
    const { module } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const jobs = await bridge.listJobs('nimi.notes');
    assert.deepEqual(jobs, [installJob()]);
  });

  test('watchJobEvents yields each typed job-event frame in order', async () => {
    const { module } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const stream = await bridge.watchJobEvents({ jobId: 'job-01' });
    const seen: number[] = [];
    for await (const event of stream) {
      seen.push(event.sequence);
    }
    assert.deepEqual(seen, [0, 1]);
  });
});

// ---------------------------------------------------------------------------
// Call metadata
// ---------------------------------------------------------------------------

describe('createDesktopAppLifecycleBridge — desktop-core call metadata', () => {
  test('unary calls carry surface metadata and a timeout without renderer caller identity', async () => {
    const { module, calls } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    await bridge.install({ appId: 'nimi.notes', confirmed: true });
    const options = calls[0]?.options as {
      timeoutMs?: number;
      metadata?: { callerKind?: string; callerId?: string; surfaceId?: string };
    };
    assert.equal(options?.metadata?.callerKind, undefined);
    assert.equal(options?.metadata?.callerId, undefined);
    assert.equal(options?.metadata?.surfaceId, 'desktop.apps');
    assert.equal(typeof options?.timeoutMs, 'number');
  });

  test('watchJobEvents forwards the AbortSignal and omits a timeout', async () => {
    const { module, calls } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    const controller = new AbortController();
    await bridge.watchJobEvents({ jobId: 'job-01', signal: controller.signal });
    const options = calls[0]?.options as { signal?: AbortSignal; timeoutMs?: number };
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.timeoutMs, undefined);
  });

  test('listJobs with no appId fails closed before Runtime', async () => {
    const { module, calls } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    await assert.rejects(
      bridge.listJobs(undefined as never),
      (error: unknown) =>
        (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
    );
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed behavior
// ---------------------------------------------------------------------------

describe('createDesktopAppLifecycleBridge — fail-closed', () => {
  test('getJob rejects an empty jobId before reaching the RPC', async () => {
    const { module, calls } = stubModule();
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    await assert.rejects(() => bridge.getJob('   '), /jobId/);
    assert.equal(calls.length, 0);
  });

  test('a thrown SDK NimiError is projected through unchanged', async () => {
    const sdkError = createNimiError({
      message: 'runtime app install job is failed without a typed reason code',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_app_lifecycle_projection',
      source: 'runtime',
    });
    const { module } = stubModule({
      install: async () => {
        throw sdkError;
      },
    });
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    await assert.rejects(
      () => bridge.install({ appId: 'nimi.notes', confirmed: true }),
      (error: unknown) => {
        assert.equal(
          (error as { reasonCode?: string }).reasonCode,
          ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        );
        return true;
      },
    );
  });

  test('an opaque transport failure is normalized to RUNTIME_CALL_FAILED', async () => {
    const { module } = stubModule({
      update: async () => {
        throw new Error('socket hang up');
      },
    });
    const bridge = createDesktopAppLifecycleBridge({ getModule: () => module });
    await assert.rejects(
      () => bridge.update({ appId: 'nimi.notes', confirmed: true }),
      (error: unknown) => {
        assert.equal(
          (error as { reasonCode?: string }).reasonCode,
          ReasonCode.RUNTIME_CALL_FAILED,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

describe('asAppLifecycleNimiError / formatAppLifecycleErrorDetail', () => {
  test('asAppLifecycleNimiError preserves an existing SDK NimiError reason code', () => {
    const sdkError = createNimiError({
      message: 'descriptor not admitted',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
      actionHint: 'pass_admitted_nimi_app_id',
      source: 'sdk',
    });
    assert.equal(
      asAppLifecycleNimiError(sdkError).reasonCode,
      ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
    );
  });

  test('formatAppLifecycleErrorDetail renders message and reason code', () => {
    const detail = formatAppLifecycleErrorDetail(new Error('socket hang up'));
    assert.match(detail, /socket hang up/);
    assert.match(detail, new RegExp(ReasonCode.RUNTIME_CALL_FAILED));
  });
});
