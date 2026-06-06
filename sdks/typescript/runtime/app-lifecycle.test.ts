import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AppHealthRepairAction,
  AppInstallJobPhase,
  AppInstallJobState,
  AppInstallSourceKind,
  AppLifecycleJobKind,
  AppOpenFlowStep,
  AppOpenState,
  AppPackageReadinessState,
  AppStorageState,
  ReasonCode as RuntimeGeneratedReasonCode,
  type AppInstallJob,
  type AppInstallJobEvent,
  type GetAppInstallJobRequest,
  type GetAppPackageReadinessRequest,
  type GetAppStorageRequest,
  type HealthRepairAppRequest,
  type InstallAppRequest,
  type ListAppInstallJobsRequest,
  type OpenAppRequest,
  type RuntimeTypedCallOptions,
  type UninstallAppRequest,
  type UpdateAppRequest,
  type WatchAppInstallJobEventsRequest,
} from '../core-generated/runtime-typed-client';
import { CoreClient, type CoreTransport } from '../core-client';
import { ReasonCode as SdkReasonCode } from '../types';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import {
  Runtime,
  createNimiRuntimeAppLifecycleClient,
  decodeNimiRuntimeAppInstallJob,
  decodeNimiRuntimeAppJobEvent,
  decodeNimiRuntimeAppOpenProjection,
  decodeNimiRuntimeAppPackageReadinessProjection,
  decodeNimiRuntimeAppStorageProjection,
  decodeNimiRuntimeAppUninstallResult,
  type NimiRuntimeAppLifecycleGeneratedClient,
} from './index';

function storageRoot() {
  return {
    appRoot: '/nimi/apps/nimi.notes',
    releaseRoot: '/nimi/apps/nimi.notes/releases/1.0.0',
    durableDataRoot: '/nimi/data/nimi.notes',
    cacheRoot: '/nimi/cache/nimi.notes',
    tempRoot: '/nimi/tmp/nimi.notes',
  };
}

function generatedJob(overrides: Partial<AppInstallJob> = {}): AppInstallJob {
  return {
    jobId: 'job-1',
    appId: 'nimi.notes',
    releaseDescriptorRef: 'release:nimi.notes@1.0.0',
    installedVersion: '1.0.0',
    state: AppInstallJobState.IN_PROGRESS,
    phase: AppInstallJobPhase.DOWNLOAD,
    sourceKind: AppInstallSourceKind.BUNDLED,
    sha256: '',
    artifactBytes: '42',
    storage: storageRoot(),
    reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
    failureDetail: '',
    retryable: false,
    createdAt: '2026-06-05T01:00:00.000Z',
    updatedAt: '2026-06-05T01:01:00.000Z',
    kind: AppLifecycleJobKind.INSTALL,
    previousVersion: '',
    ...overrides,
  };
}

function createClientStub(overrides: Partial<NimiRuntimeAppLifecycleGeneratedClient> = {}) {
  const installCalls: Array<{ request: InstallAppRequest; options?: RuntimeTypedCallOptions }> = [];
  const uninstallCalls: Array<{ request: UninstallAppRequest; options?: RuntimeTypedCallOptions }> = [];
  const storageCalls: Array<{ request: GetAppStorageRequest; options?: RuntimeTypedCallOptions }> = [];
  const readinessCalls: Array<{ request: GetAppPackageReadinessRequest; options?: RuntimeTypedCallOptions }> = [];
  const getJobCalls: Array<{ request: GetAppInstallJobRequest; options?: RuntimeTypedCallOptions }> = [];
  const listJobCalls: Array<{ request: ListAppInstallJobsRequest; options?: RuntimeTypedCallOptions }> = [];
  const watchJobCalls: Array<{ request: WatchAppInstallJobEventsRequest; options?: RuntimeTypedCallOptions }> = [];
  const updateCalls: Array<{ request: UpdateAppRequest; options?: RuntimeTypedCallOptions }> = [];
  const healthRepairCalls: HealthRepairAppRequest[] = [];
  const openCalls: OpenAppRequest[] = [];
  const client: NimiRuntimeAppLifecycleGeneratedClient = {
    async installApp(request, options) {
      installCalls.push({ request, options });
      return { job: generatedJob() };
    },
    async uninstallApp(request, options) {
      uninstallCalls.push({ request, options });
      return {
        result: {
          appId: request.appId,
          releaseRemoved: true,
          durableDataRemoved: Boolean(request.deleteDurableData),
          storage: storageRoot(),
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
        },
        job: generatedJob({
          state: AppInstallJobState.UNINSTALLED,
          phase: AppInstallJobPhase.UNINSTALLED,
          kind: AppLifecycleJobKind.UNINSTALL,
        }),
      };
    },
    async getAppStorage(request, options) {
      storageCalls.push({ request, options });
      return {
        projection: {
          appId: request.appId,
          state: AppStorageState.READY,
          appRoot: '/nimi/apps/nimi.notes',
          activeReleaseRoot: '/nimi/apps/nimi.notes/releases/1.0.0',
          durableDataRoot: '/nimi/data/nimi.notes',
          cacheRoot: '/nimi/cache/nimi.notes',
          tempRoot: '/nimi/tmp/nimi.notes',
          activeVersion: '1.0.0',
          storagePolicyRef: 'policy:nimi.notes',
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
          detail: '',
        },
      };
    },
    async getAppPackageReadiness(request, options) {
      readinessCalls.push({ request, options });
      return {
        projection: {
          appId: request.appId,
          releaseDescriptorRef: 'release:nimi.notes@1.0.0',
          storagePolicyRef: 'policy:nimi.notes',
          expectedVersion: '1.0.0',
          activeVersion: '1.0.0',
          installedVersion: '1.0.0',
          sha256: 'abc',
          verificationState: 'verified',
          state: AppPackageReadinessState.READY,
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
          detail: '',
        },
      };
    },
    async getAppInstallJob(request, options) {
      getJobCalls.push({ request, options });
      return { job: generatedJob({ jobId: request.jobId }) };
    },
    async listAppInstallJobs(request, options) {
      listJobCalls.push({ request, options });
      return { jobs: [generatedJob({ appId: request.appId || 'nimi.notes' })] };
    },
    watchAppInstallJobEvents(request, options) {
      watchJobCalls.push({ request, options });
      return (async function* (): AsyncIterable<AppInstallJobEvent> {
        yield {
          sequence: '7',
          job: generatedJob({ jobId: request.jobId || 'job-1' }),
          timestamp: { seconds: '1780617661', nanos: 123_000_000 },
        };
      })();
    },
    async updateApp(request, options) {
      updateCalls.push({ request, options });
      return {
        job: generatedJob({
          appId: request.appId,
          kind: AppLifecycleJobKind.UPDATE,
          phase: AppInstallJobPhase.SWAP,
          previousVersion: '0.9.0',
        }),
      };
    },
    async healthRepairApp(request) {
      healthRepairCalls.push(request);
      return {
        job: generatedJob({
          appId: request.appId,
          jobId: request.jobId || 'repair-job',
          kind: AppLifecycleJobKind.REPAIR,
        }),
      };
    },
    async openApp(request) {
      openCalls.push(request);
      return {
        projection: {
          appId: request.appId,
          state: AppOpenState.LAUNCHED,
          reachedStep: AppOpenFlowStep.LAUNCH,
          launched: true,
          activeVersion: '1.0.0',
          scope: request.scope,
          reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
          detail: '',
        },
      };
    },
    ...overrides,
  };
  return {
    client,
    installCalls,
    uninstallCalls,
    storageCalls,
    readinessCalls,
    getJobCalls,
    listJobCalls,
    watchJobCalls,
    updateCalls,
    healthRepairCalls,
    openCalls,
  };
}

test('Nimi Runtime app lifecycle client decodes generated jobs to canonical strings', async () => {
  const { client, installCalls } = createClientStub();
  const lifecycle = createNimiRuntimeAppLifecycleClient({ client });
  const job = await lifecycle.install(
    { appId: ' nimi.notes ', confirmed: true },
    { timeoutMs: 123, metadata: { callerId: 'test' } },
  );

  assert.equal(job.appId, 'nimi.notes');
  assert.equal(job.state, 'in_progress');
  assert.equal(job.phase, 'download');
  assert.equal(job.kind, 'install');
  assert.equal(job.sourceKind, 'bundled');
  assert.equal(job.reasonCode, 'ACTION_EXECUTED');
  assert.equal(job.artifactBytes, 42);
  assert.deepEqual(installCalls, [{
    request: { appId: 'nimi.notes', confirmed: true },
    options: { timeoutMs: 123, metadata: { callerId: 'test' } },
  }]);
});

test('Nimi Runtime app lifecycle client maps all lifecycle request envelopes', async () => {
  const {
    client,
    uninstallCalls,
    storageCalls,
    readinessCalls,
    getJobCalls,
    listJobCalls,
    watchJobCalls,
    updateCalls,
  } = createClientStub();
  const lifecycle = createNimiRuntimeAppLifecycleClient({ client });
  const options = { timeoutMs: 250, metadata: { callerId: 'lifecycle-test' } };

  const uninstall = await lifecycle.uninstall({
    appId: ' nimi.notes ',
    deleteDurableData: true,
    destructiveDataDeleteConfirmed: true,
  }, options);
  assert.equal(uninstall.appId, 'nimi.notes');
  assert.equal(uninstall.releaseRemoved, true);
  assert.equal(uninstall.durableDataRemoved, true);
  assert.equal(uninstall.job.kind, 'uninstall');
  assert.deepEqual(uninstallCalls, [{
    request: {
      appId: 'nimi.notes',
      deleteDurableData: true,
      destructiveDataDeleteConfirmed: true,
    },
    options,
  }]);

  const storage = await lifecycle.storage({ appId: ' nimi.notes ' }, options);
  assert.equal(storage.appId, 'nimi.notes');
  assert.equal(storage.state, 'ready');
  assert.deepEqual(storageCalls, [{ request: { appId: 'nimi.notes' }, options }]);

  const readiness = await lifecycle.packageReadiness({ appId: ' nimi.notes ' }, options);
  assert.equal(readiness.state, 'ready');
  assert.deepEqual(readinessCalls, [{ request: { appId: 'nimi.notes' }, options }]);

  const job = await lifecycle.getJob({ jobId: ' job-2 ' }, options);
  assert.equal(job.jobId, 'job-2');
  assert.deepEqual(getJobCalls, [{ request: { jobId: 'job-2' }, options }]);

  const scopedJobs = await lifecycle.listJobs({ appId: ' nimi.notes ' }, options);
  const allJobs = await lifecycle.listJobs(undefined, options);
  assert.equal(scopedJobs[0]?.appId, 'nimi.notes');
  assert.equal(allJobs[0]?.appId, 'nimi.notes');
  assert.deepEqual(listJobCalls, [
    { request: { appId: 'nimi.notes' }, options },
    { request: { appId: '' }, options },
  ]);

  const update = await lifecycle.update({ appId: ' nimi.notes ', confirmed: false }, options);
  assert.equal(update.kind, 'update');
  assert.equal(update.previousVersion, '0.9.0');
  assert.deepEqual(updateCalls, [{
    request: { appId: 'nimi.notes', confirmed: false },
    options,
  }]);

  const events = [];
  for await (const event of lifecycle.watchJobEvents(undefined, options)) {
    events.push(event.job.jobId);
  }
  assert.deepEqual(events, ['job-1']);
  assert.deepEqual(watchJobCalls, [{ request: { jobId: '' }, options }]);
});

test('Nimi Runtime app lifecycle client maps repair action and validates open scope', async () => {
  const { client, healthRepairCalls, openCalls } = createClientStub();
  const lifecycle = createNimiRuntimeAppLifecycleClient({ client });

  await lifecycle.healthRepair({ appId: 'nimi.notes', action: 'cancel' });
  await lifecycle.healthRepair({ appId: 'nimi.notes', action: 'retry' });
  await lifecycle.healthRepair({ appId: 'nimi.notes', action: 'repair' });
  await lifecycle.healthRepair({ appId: 'nimi.notes', action: 'reinstall', jobId: 'job-1' });
  assert.deepEqual(healthRepairCalls.map((call) => call.action), [
    AppHealthRepairAction.CANCEL,
    AppHealthRepairAction.RETRY,
    AppHealthRepairAction.REPAIR,
    AppHealthRepairAction.REINSTALL,
  ]);
  assert.equal(healthRepairCalls[3]?.jobId, 'job-1');

  const openProjection = await lifecycle.open({
    appId: 'nimi.notes',
    scope: { kind: 'app', ownerId: 'nimi.notes', surfaceId: 'compose' },
  });
  assert.equal(openProjection.state, 'launched');
  assert.deepEqual(openProjection.scope, { kind: 'app', ownerId: 'nimi.notes', surfaceId: 'compose' });
  assert.equal(openCalls[0]?.scope?.kind, 'app');
  assert.equal(openCalls[0]?.scope?.ownerId, 'nimi.notes');

  await assert.rejects(
    lifecycle.open({ appId: 'nimi.notes', scope: { kind: 'app', ownerId: 'other.app' } }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
  );
  await assert.rejects(
    lifecycle.healthRepair({ appId: 'nimi.notes', action: 'unknown' as never }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.SDK_RUNTIME_APP_LIFECYCLE_REPAIR_ACTION_INVALID,
  );
  await assert.rejects(
    lifecycle.open({ appId: 'nimi.notes', scope: undefined as never }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
  );
});

test('Nimi Runtime app lifecycle stream decodes sequence and timestamp', async () => {
  const { client } = createClientStub();
  const lifecycle = createNimiRuntimeAppLifecycleClient({ client });
  const frames = [];

  for await (const frame of lifecycle.watchJobEvents({ jobId: 'job-stream' })) {
    frames.push(frame);
  }

  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.sequence, 7);
  assert.equal(frames[0]?.job.jobId, 'job-stream');
  assert.equal(frames[0]?.timestamp, '2026-06-05T00:01:01.123Z');
});

test('Nimi Runtime app lifecycle decoder fails closed on missing terminal reason', () => {
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({
      state: AppInstallJobState.FAILED,
      phase: AppInstallJobPhase.FAILED,
      reasonCode: RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED,
    })),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

test('Nimi Runtime app lifecycle decoder covers generated enum matrices', () => {
  const phaseCases: Array<[AppInstallJobPhase, string]> = [
    [AppInstallJobPhase.QUEUED, 'queued'],
    [AppInstallJobPhase.RESOLVE_DESCRIPTOR, 'resolve_descriptor'],
    [AppInstallJobPhase.DOWNLOAD, 'download'],
    [AppInstallJobPhase.VERIFY, 'verify'],
    [AppInstallJobPhase.MATERIALIZE, 'materialize'],
    [AppInstallJobPhase.UNPACK, 'unpack'],
    [AppInstallJobPhase.EVIDENCE, 'evidence'],
    [AppInstallJobPhase.INSTALLED, 'installed'],
    [AppInstallJobPhase.SWAP, 'swap'],
    [AppInstallJobPhase.FAILED, 'failed'],
    [AppInstallJobPhase.CANCELLED, 'cancelled'],
    [AppInstallJobPhase.UNINSTALLED, 'uninstalled'],
  ];
  for (const [phase, expected] of phaseCases) {
    assert.equal(decodeNimiRuntimeAppInstallJob(generatedJob({ phase })).phase, expected);
  }

  const stateCases: Array<[AppInstallJobState, string]> = [
    [AppInstallJobState.QUEUED, 'queued'],
    [AppInstallJobState.IN_PROGRESS, 'in_progress'],
    [AppInstallJobState.INSTALLED, 'installed'],
    [AppInstallJobState.FAILED, 'failed'],
    [AppInstallJobState.CANCELLED, 'cancelled'],
    [AppInstallJobState.UNINSTALLED, 'uninstalled'],
  ];
  for (const [state, expected] of stateCases) {
    assert.equal(decodeNimiRuntimeAppInstallJob(generatedJob({ state })).state, expected);
  }

  const kindCases: Array<[AppLifecycleJobKind, string]> = [
    [AppLifecycleJobKind.INSTALL, 'install'],
    [AppLifecycleJobKind.UPDATE, 'update'],
    [AppLifecycleJobKind.REPAIR, 'repair'],
    [AppLifecycleJobKind.UNINSTALL, 'uninstall'],
  ];
  for (const [kind, expected] of kindCases) {
    assert.equal(decodeNimiRuntimeAppInstallJob(generatedJob({ kind })).kind, expected);
  }

  assert.equal(
    decodeNimiRuntimeAppInstallJob(generatedJob({ sourceKind: AppInstallSourceKind.EXTERNAL_ARTIFACT })).sourceKind,
    'external_artifact',
  );
  const detailed = decodeNimiRuntimeAppInstallJob(generatedJob({
    previousVersion: '0.9.0',
    sha256: 'sha-256',
    failureDetail: 'checksum mismatch',
    retryable: true,
  }));
  assert.equal(detailed.previousVersion, '0.9.0');
  assert.equal(detailed.sha256, 'sha-256');
  assert.equal(detailed.failureDetail, 'checksum mismatch');
  assert.equal(detailed.retryable, true);
});

test('Nimi Runtime app lifecycle projection decoders normalize storage readiness and open matrices', () => {
  const storageStates: Array<[AppStorageState, string, RuntimeGeneratedReasonCode]> = [
    [AppStorageState.READY, 'ready', RuntimeGeneratedReasonCode.ACTION_EXECUTED],
    [AppStorageState.INSTALL_REQUIRED, 'install_required', RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED],
    [AppStorageState.REPAIR_REQUIRED, 'repair_required', RuntimeGeneratedReasonCode.APP_NOT_REGISTERED],
    [AppStorageState.STORAGE_UNAVAILABLE, 'storage_unavailable', RuntimeGeneratedReasonCode.PROTOCOL_ENVELOPE_INVALID],
  ];
  for (const [state, expected, reasonCode] of storageStates) {
    const projection = decodeNimiRuntimeAppStorageProjection({
      appId: 'nimi.notes',
      state,
      appRoot: '/apps/nimi.notes',
      activeReleaseRoot: state === AppStorageState.INSTALL_REQUIRED ? '' : '/apps/nimi.notes/releases/1.0.0',
      durableDataRoot: '/data/nimi.notes',
      cacheRoot: '/cache/nimi.notes',
      tempRoot: '/tmp/nimi.notes',
      activeVersion: state === AppStorageState.INSTALL_REQUIRED ? '' : '1.0.0',
      storagePolicyRef: 'policy:nimi.notes',
      reasonCode,
      detail: state === AppStorageState.READY ? '' : 'not ready',
    });
    assert.equal(projection.state, expected);
    if (state === AppStorageState.INSTALL_REQUIRED) {
      assert.equal('activeReleaseRoot' in projection, false);
      assert.equal('activeVersion' in projection, false);
    }
  }

  const readinessStates: Array<[AppPackageReadinessState, string, RuntimeGeneratedReasonCode]> = [
    [AppPackageReadinessState.READY, 'ready', RuntimeGeneratedReasonCode.ACTION_EXECUTED],
    [AppPackageReadinessState.INSTALL_REQUIRED, 'install_required', RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED],
    [AppPackageReadinessState.UPDATE_REQUIRED, 'update_required', RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED],
    [AppPackageReadinessState.REPAIR_REQUIRED, 'repair_required', RuntimeGeneratedReasonCode.APP_NOT_REGISTERED],
    [AppPackageReadinessState.BLOCKED, 'blocked', RuntimeGeneratedReasonCode.PRINCIPAL_UNAUTHORIZED],
  ];
  for (const [state, expected, reasonCode] of readinessStates) {
    const projection = decodeNimiRuntimeAppPackageReadinessProjection({
      appId: 'nimi.notes',
      releaseDescriptorRef: 'release:nimi.notes@1.0.0',
      storagePolicyRef: 'policy:nimi.notes',
      expectedVersion: '1.0.0',
      activeVersion: state === AppPackageReadinessState.INSTALL_REQUIRED ? '' : '1.0.0',
      installedVersion: state === AppPackageReadinessState.INSTALL_REQUIRED ? '' : '1.0.0',
      sha256: state === AppPackageReadinessState.READY ? 'sha-256' : '',
      verificationState: state === AppPackageReadinessState.READY ? 'verified' : '',
      state,
      reasonCode,
      detail: state === AppPackageReadinessState.READY ? '' : 'not ready',
    });
    assert.equal(projection.state, expected);
  }

  const openSteps: Array<[AppOpenFlowStep, string]> = [
    [AppOpenFlowStep.RESOLVE_REGISTRY, 'resolve_registry'],
    [AppOpenFlowStep.VERIFY_PACKAGE, 'verify_package'],
    [AppOpenFlowStep.VERIFY_LIBRARY, 'verify_library'],
    [AppOpenFlowStep.VERIFY_APP_DATA, 'verify_app_data'],
    [AppOpenFlowStep.VERIFY_PERMISSIONS, 'verify_permissions'],
    [AppOpenFlowStep.ENSURE_AICONFIG, 'ensure_aiconfig'],
    [AppOpenFlowStep.VALIDATE_MANIFEST, 'validate_manifest'],
    [AppOpenFlowStep.LAUNCH, 'launch'],
  ];
  for (const [reachedStep, expected] of openSteps) {
    const projection = decodeNimiRuntimeAppOpenProjection({
      appId: 'nimi.notes',
      state: AppOpenState.BLOCKED,
      reachedStep,
      launched: false,
      activeVersion: '',
      scope: undefined,
      reasonCode: RuntimeGeneratedReasonCode.PRINCIPAL_UNAUTHORIZED,
      detail: 'blocked before launch',
    });
    assert.equal(projection.reachedStep, expected);
    assert.equal(projection.state, 'blocked');
    assert.equal(projection.launched, false);
  }
});

test('Nimi Runtime app lifecycle decoders fail closed on malformed Runtime projections', () => {
  const decodeFailure = (error: unknown) =>
    (error as { reasonCode?: string }).reasonCode === SdkReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED;

  assert.throws(() => decodeNimiRuntimeAppInstallJob(undefined), decodeFailure);
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({ artifactBytes: '-1' })),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({ storage: undefined })),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({ phase: -1 as AppInstallJobPhase })),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({ state: -1 as AppInstallJobState })),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({ kind: -1 as AppLifecycleJobKind })),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({ sourceKind: -1 as AppInstallSourceKind })),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppInstallJob(generatedJob({ reasonCode: 99_999 as RuntimeGeneratedReasonCode })),
    decodeFailure,
  );

  assert.throws(() => decodeNimiRuntimeAppUninstallResult(undefined, generatedJob()), decodeFailure);
  assert.throws(
    () => decodeNimiRuntimeAppUninstallResult({
      appId: 'nimi.notes',
      releaseRemoved: true,
      durableDataRemoved: false,
      storage: undefined,
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
    }, generatedJob()),
    decodeFailure,
  );

  assert.throws(() => decodeNimiRuntimeAppStorageProjection(undefined), decodeFailure);
  assert.throws(
    () => decodeNimiRuntimeAppStorageProjection({
      appId: 'nimi.notes',
      state: AppStorageState.REPAIR_REQUIRED,
      appRoot: '/apps/nimi.notes',
      activeReleaseRoot: '',
      durableDataRoot: '/data/nimi.notes',
      cacheRoot: '/cache/nimi.notes',
      tempRoot: '/tmp/nimi.notes',
      activeVersion: '',
      storagePolicyRef: 'policy:nimi.notes',
      reasonCode: RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED,
      detail: '',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppStorageProjection({
      appId: 'nimi.notes',
      state: -1 as AppStorageState,
      appRoot: '/apps/nimi.notes',
      activeReleaseRoot: '',
      durableDataRoot: '/data/nimi.notes',
      cacheRoot: '/cache/nimi.notes',
      tempRoot: '/tmp/nimi.notes',
      activeVersion: '',
      storagePolicyRef: 'policy:nimi.notes',
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
      detail: '',
    }),
    decodeFailure,
  );

  assert.throws(() => decodeNimiRuntimeAppPackageReadinessProjection(undefined), decodeFailure);
  assert.throws(
    () => decodeNimiRuntimeAppPackageReadinessProjection({
      appId: 'nimi.notes',
      releaseDescriptorRef: 'release:nimi.notes@1.0.0',
      storagePolicyRef: 'policy:nimi.notes',
      expectedVersion: '1.0.0',
      activeVersion: '',
      installedVersion: '',
      sha256: '',
      verificationState: '',
      state: -1 as AppPackageReadinessState,
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
      detail: '',
    }),
    decodeFailure,
  );

  assert.throws(() => decodeNimiRuntimeAppOpenProjection(undefined), decodeFailure);
  assert.throws(
    () => decodeNimiRuntimeAppOpenProjection({
      appId: 'nimi.notes',
      state: AppOpenState.LAUNCHED,
      reachedStep: AppOpenFlowStep.LAUNCH,
      launched: false,
      activeVersion: '1.0.0',
      scope: { kind: 'app', ownerId: 'nimi.notes' },
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
      detail: '',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppOpenProjection({
      appId: 'nimi.notes',
      state: AppOpenState.BLOCKED,
      reachedStep: AppOpenFlowStep.VERIFY_PACKAGE,
      launched: true,
      activeVersion: '',
      scope: undefined,
      reasonCode: RuntimeGeneratedReasonCode.PRINCIPAL_UNAUTHORIZED,
      detail: '',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppOpenProjection({
      appId: 'nimi.notes',
      state: AppOpenState.LAUNCHED,
      reachedStep: AppOpenFlowStep.LAUNCH,
      launched: true,
      activeVersion: '1.0.0',
      scope: undefined,
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
      detail: '',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppOpenProjection({
      appId: 'nimi.notes',
      state: AppOpenState.LAUNCHED,
      reachedStep: AppOpenFlowStep.LAUNCH,
      launched: true,
      activeVersion: '1.0.0',
      scope: { kind: 'app', ownerId: 'other.app' },
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
      detail: '',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppOpenProjection({
      appId: 'nimi.notes',
      state: -1 as AppOpenState,
      reachedStep: AppOpenFlowStep.LAUNCH,
      launched: false,
      activeVersion: '',
      scope: undefined,
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
      detail: '',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppOpenProjection({
      appId: 'nimi.notes',
      state: AppOpenState.BLOCKED,
      reachedStep: -1 as AppOpenFlowStep,
      launched: false,
      activeVersion: '',
      scope: undefined,
      reasonCode: RuntimeGeneratedReasonCode.PRINCIPAL_UNAUTHORIZED,
      detail: '',
    }),
    decodeFailure,
  );

  assert.throws(
    () => decodeNimiRuntimeAppJobEvent({ sequence: '-1', job: generatedJob() }),
    decodeFailure,
  );
});

test('Nimi Runtime app lifecycle readiness and open projections fail closed on missing blocked reason', async () => {
  const lifecycle = createNimiRuntimeAppLifecycleClient({
    client: createClientStub({
      async getAppPackageReadiness() {
        return {
          projection: {
            appId: 'nimi.notes',
            releaseDescriptorRef: 'release:nimi.notes@1.0.0',
            storagePolicyRef: 'policy:nimi.notes',
            expectedVersion: '1.0.0',
            activeVersion: '',
            installedVersion: '',
            sha256: '',
            verificationState: '',
            state: AppPackageReadinessState.BLOCKED,
            reasonCode: RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED,
            detail: '',
          },
        };
      },
      async openApp(request) {
        return {
          projection: {
            appId: request.appId,
            state: AppOpenState.BLOCKED,
            reachedStep: AppOpenFlowStep.VERIFY_PACKAGE,
            launched: false,
            activeVersion: '',
            scope: request.scope,
            reasonCode: RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED,
            detail: '',
          },
        };
      },
    }).client,
  });

  await assert.rejects(
    lifecycle.packageReadiness({ appId: 'nimi.notes' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
  await assert.rejects(
    lifecycle.open({ appId: 'nimi.notes', scope: { kind: 'app', ownerId: 'nimi.notes' } }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SdkReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

class AppLifecycleFacadeTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];
  readonly streamCalls: CoreStreamRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.methodId === '/nimi.runtime.v1.RuntimeAppService/InstallApp') {
      return { job: generatedJob() } as Response;
    }
    throw new Error(`unexpected unary ${request.methodId}`);
  }

  async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
    this.streamCalls.push(request);
    if (request.methodId === '/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents') {
      yield { sequence: '1', job: generatedJob() } as Response;
      return;
    }
    throw new Error(`unexpected stream ${request.methodId}`);
  }
}

test('Runtime facade exposes canonical appLifecycle client over generated RuntimeAppService', async () => {
  const transport = new AppLifecycleFacadeTransport();
  const runtime = new Runtime({
    transport,
    appId: 'nimi.desktop',
  });

  const job = await runtime.appLifecycle.install({ appId: 'nimi.notes', confirmed: true });
  assert.equal(job.kind, 'install');
  assert.equal(transport.unaryCalls[0]?.methodId, '/nimi.runtime.v1.RuntimeAppService/InstallApp');

  const events = [];
  for await (const event of runtime.appLifecycle.watchJobEvents({ jobId: 'job-1' })) {
    events.push(event.sequence);
  }
  assert.deepEqual(events, [1]);
  assert.equal(transport.streamCalls[0]?.methodId, '/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents');
});
