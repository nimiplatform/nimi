import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import {
  AppHealthRepairAction,
  AppInstallJobPhase,
  AppInstallJobState,
  AppInstallSourceKind,
  AppLifecycleJobKind,
} from '../../src/runtime/generated/runtime/v1/app.js';
import { ReasonCode as RuntimeReasonCode } from '../../src/runtime/generated/runtime/v1/common.js';
import {
  AppOpenFlowStep,
  AppOpenState,
} from '../../src/runtime/generated/runtime/v1/app.js';
import type {
  AppInstallJob,
  AppInstallJobEvent,
  HealthRepairAppRequest,
  InstallAppRequest,
  OpenAppRequest,
  UninstallAppRequest,
  UpdateAppRequest,
} from '../../src/runtime/generated/runtime/v1/app.js';
import {
  createRuntimeAppLifecycleModule,
  decodeAppInstallJob,
} from '../../src/runtime/runtime-app-lifecycle.js';
import type { RuntimeClient } from '../../src/runtime/types-client-interfaces.js';
import type { RuntimeInternalContext } from '../../src/runtime/internal-context.js';

function storage() {
  return {
    appRoot: '/data/apps/app-1',
    releaseRoot: '/data/apps/app-1/releases/1.0.0',
    durableDataRoot: '/data/apps/app-1/data',
    cacheRoot: '/data/apps/app-1/cache',
    tempRoot: '/data/apps/app-1/tmp',
  };
}

function protoJob(overrides: Partial<AppInstallJob> = {}): AppInstallJob {
  return {
    jobId: 'job-1',
    appId: 'app-1',
    releaseDescriptorRef: 'descriptor:app-1@1.0.0',
    installedVersion: '1.0.0',
    state: AppInstallJobState.IN_PROGRESS,
    phase: AppInstallJobPhase.DOWNLOAD,
    sourceKind: AppInstallSourceKind.EXTERNAL_ARTIFACT,
    sha256: '',
    artifactBytes: '4096',
    storage: storage(),
    reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    failureDetail: '',
    retryable: false,
    createdAt: '2026-05-21T00:00:00Z',
    updatedAt: '2026-05-21T00:00:01Z',
    kind: AppLifecycleJobKind.INSTALL,
    previousVersion: '',
    ...overrides,
  };
}

type MockClientCapture = {
  installRequest?: InstallAppRequest;
  uninstallRequest?: UninstallAppRequest;
  updateRequest?: UpdateAppRequest;
  healthRepairRequest?: HealthRepairAppRequest;
  openRequest?: OpenAppRequest;
  getJobId?: string;
  listAppId?: string;
  watchJobId?: string;
};

function mockCtx(
  client: Partial<RuntimeClient['app']>,
): { ctx: RuntimeInternalContext; capture: MockClientCapture } {
  const capture: MockClientCapture = {};
  const appClient = {
    installApp: async (request: InstallAppRequest) => {
      capture.installRequest = request;
      throw new Error('installApp not stubbed');
    },
    uninstallApp: async (request: UninstallAppRequest) => {
      capture.uninstallRequest = request;
      throw new Error('uninstallApp not stubbed');
    },
    getAppInstallJob: async (request: { jobId: string }) => {
      capture.getJobId = request.jobId;
      throw new Error('getAppInstallJob not stubbed');
    },
    listAppInstallJobs: async (request: { appId: string }) => {
      capture.listAppId = request.appId;
      throw new Error('listAppInstallJobs not stubbed');
    },
    watchAppInstallJobEvents: async (request: { jobId: string }) => {
      capture.watchJobId = request.jobId;
      throw new Error('watchAppInstallJobEvents not stubbed');
    },
    updateApp: async (request: UpdateAppRequest) => {
      capture.updateRequest = request;
      throw new Error('updateApp not stubbed');
    },
    healthRepairApp: async (request: HealthRepairAppRequest) => {
      capture.healthRepairRequest = request;
      throw new Error('healthRepairApp not stubbed');
    },
    openApp: async (request: OpenAppRequest) => {
      capture.openRequest = request;
      throw new Error('openApp not stubbed');
    },
    ...client,
  };
  const ctx = {
    appId: 'test-app',
    invokeWithClient: async <T>(op: (c: RuntimeClient) => Promise<T>): Promise<T> =>
      op({ app: appClient } as unknown as RuntimeClient),
  } as unknown as RuntimeInternalContext;
  return { ctx, capture };
}

// ── decodeAppInstallJob ────────────────────────────────────────────────

test('decodeAppInstallJob: maps a full in-progress job projection', () => {
  const decoded = decodeAppInstallJob(protoJob());
  assert.equal(decoded.jobId, 'job-1');
  assert.equal(decoded.appId, 'app-1');
  assert.equal(decoded.kind, 'install');
  assert.equal(decoded.state, 'in_progress');
  assert.equal(decoded.phase, 'download');
  assert.equal(decoded.sourceKind, 'external_artifact');
  assert.equal(decoded.artifactBytes, 4096);
  assert.equal(decoded.retryable, false);
  assert.equal(decoded.reasonCode, undefined);
  assert.equal(decoded.storage.releaseRoot, '/data/apps/app-1/releases/1.0.0');
});

test('decodeAppInstallJob: fail-closes on a missing job projection', () => {
  assert.throws(
    () => decodeAppInstallJob(undefined),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

test('decodeAppInstallJob: a failed job carries the typed reason code verbatim', () => {
  const decoded = decodeAppInstallJob(
    protoJob({
      state: AppInstallJobState.FAILED,
      phase: AppInstallJobPhase.FAILED,
      reasonCode: RuntimeReasonCode.APP_INSTALL_DIGEST_MISMATCH,
      failureDetail: 'sha256 mismatch',
      retryable: true,
    }),
  );
  assert.equal(decoded.state, 'failed');
  assert.equal(decoded.reasonCode, 'APP_INSTALL_DIGEST_MISMATCH');
  assert.equal(decoded.failureDetail, 'sha256 mismatch');
  assert.equal(decoded.retryable, true);
});

test('decodeAppInstallJob: fail-closes when a failed job omits its reason code', () => {
  assert.throws(
    () =>
      decodeAppInstallJob(
        protoJob({
          state: AppInstallJobState.FAILED,
          phase: AppInstallJobPhase.FAILED,
          reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
        }),
      ),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

test('decodeAppInstallJob: a cancelled job maps state, phase and reason', () => {
  const decoded = decodeAppInstallJob(
    protoJob({
      state: AppInstallJobState.CANCELLED,
      phase: AppInstallJobPhase.CANCELLED,
      kind: AppLifecycleJobKind.UPDATE,
      reasonCode: RuntimeReasonCode.APP_LIFECYCLE_JOB_CANCELLED,
      previousVersion: '0.9.0',
    }),
  );
  assert.equal(decoded.state, 'cancelled');
  assert.equal(decoded.phase, 'cancelled');
  assert.equal(decoded.kind, 'update');
  assert.equal(decoded.reasonCode, 'APP_LIFECYCLE_JOB_CANCELLED');
  assert.equal(decoded.previousVersion, '0.9.0');
});

test('decodeAppInstallJob: fail-closes on an unspecified storage projection', () => {
  assert.throws(
    () => decodeAppInstallJob(protoJob({ storage: undefined })),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

// ── install ────────────────────────────────────────────────────────────

test('install: forwards confirmed flag and decodes the job', async () => {
  const { ctx, capture } = mockCtx({
    installApp: async (request) => {
      capture.installRequest = request;
      return { job: protoJob({ phase: AppInstallJobPhase.QUEUED }) };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const job = await module.install({ appId: 'app-1', confirmed: true });
  assert.deepEqual(capture.installRequest, { appId: 'app-1', confirmed: true });
  assert.equal(job.phase, 'queued');
});

test('install: rejects an empty appId before any runtime call', async () => {
  const { ctx } = mockCtx({});
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () => module.install({ appId: '  ', confirmed: true }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
  );
});

test('install: fail-closes when the runtime omits the job', async () => {
  const { ctx } = mockCtx({
    installApp: async () => ({ job: undefined }),
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () => module.install({ appId: 'app-1', confirmed: true }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

// ── uninstall ──────────────────────────────────────────────────────────

test('uninstall: forwards destructive flags and decodes the result', async () => {
  const { ctx, capture } = mockCtx({
    uninstallApp: async (request) => {
      capture.uninstallRequest = request;
      return {
        result: {
          appId: 'app-1',
          releaseRemoved: true,
          durableDataRemoved: true,
          storage: storage(),
          reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
        },
        job: protoJob({
          kind: AppLifecycleJobKind.UNINSTALL,
          state: AppInstallJobState.UNINSTALLED,
          phase: AppInstallJobPhase.UNINSTALLED,
          reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
        }),
      };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const result = await module.uninstall({
    appId: 'app-1',
    deleteDurableData: true,
    destructiveDataDeleteConfirmed: true,
  });
  assert.deepEqual(capture.uninstallRequest, {
    appId: 'app-1',
    deleteDurableData: true,
    destructiveDataDeleteConfirmed: true,
  });
  assert.equal(result.releaseRemoved, true);
  assert.equal(result.durableDataRemoved, true);
  assert.equal(result.job.kind, 'uninstall');
  assert.equal(result.job.state, 'uninstalled');
  assert.equal(result.job.phase, 'uninstalled');
});

test('uninstall: defaults destructive flags to false', async () => {
  const { ctx, capture } = mockCtx({
    uninstallApp: async (request) => {
      capture.uninstallRequest = request;
      return {
        result: {
          appId: 'app-1',
          releaseRemoved: true,
          durableDataRemoved: false,
          storage: storage(),
          reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
        },
        job: protoJob({
          kind: AppLifecycleJobKind.UNINSTALL,
          state: AppInstallJobState.UNINSTALLED,
          phase: AppInstallJobPhase.UNINSTALLED,
          reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
        }),
      };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  await module.uninstall({ appId: 'app-1' });
  assert.deepEqual(capture.uninstallRequest, {
    appId: 'app-1',
    deleteDurableData: false,
    destructiveDataDeleteConfirmed: false,
  });
});

test('uninstall: fail-closes on a missing result projection', async () => {
  const { ctx } = mockCtx({
    uninstallApp: async () => ({ result: undefined }),
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () => module.uninstall({ appId: 'app-1' }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

// ── getJob / listJobs ──────────────────────────────────────────────────

test('getJob: rejects an empty jobId before any runtime call', async () => {
  const { ctx } = mockCtx({});
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () => module.getJob({ jobId: '' }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_JOB_ID_REQUIRED,
  );
});

test('getJob: forwards the jobId and decodes the job', async () => {
  const { ctx, capture } = mockCtx({
    getAppInstallJob: async (request) => {
      capture.getJobId = request.jobId;
      return { job: protoJob({ jobId: 'job-9' }) };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const job = await module.getJob({ jobId: 'job-9' });
  assert.equal(capture.getJobId, 'job-9');
  assert.equal(job.jobId, 'job-9');
});

test('listJobs: forwards an optional appId filter and decodes every job', async () => {
  const { ctx, capture } = mockCtx({
    listAppInstallJobs: async (request) => {
      capture.listAppId = request.appId;
      return { jobs: [protoJob({ jobId: 'job-a' }), protoJob({ jobId: 'job-b' })] };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const jobs = await module.listJobs({ appId: 'app-1' });
  assert.equal(capture.listAppId, 'app-1');
  assert.deepEqual(jobs.map((job) => job.jobId), ['job-a', 'job-b']);
});

test('listJobs: defaults to an empty appId filter when omitted', async () => {
  const { ctx, capture } = mockCtx({
    listAppInstallJobs: async (request) => {
      capture.listAppId = request.appId;
      return { jobs: [] };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const jobs = await module.listJobs();
  assert.equal(capture.listAppId, '');
  assert.deepEqual(jobs, []);
});

// ── watchJobEvents ─────────────────────────────────────────────────────

test('watchJobEvents: decodes each progress frame in sequence', async () => {
  const events: AppInstallJobEvent[] = [
    {
      sequence: '1',
      job: protoJob({ phase: AppInstallJobPhase.DOWNLOAD }),
      timestamp: undefined,
    },
    {
      sequence: '2',
      job: protoJob({
        state: AppInstallJobState.INSTALLED,
        phase: AppInstallJobPhase.INSTALLED,
      }),
      timestamp: undefined,
    },
  ];
  const { ctx, capture } = mockCtx({
    watchAppInstallJobEvents: async (request) => {
      capture.watchJobId = request.jobId;
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const stream = await module.watchJobEvents({ jobId: 'job-1' });
  const collected: Array<{ sequence: number; phase: string }> = [];
  for await (const frame of stream) {
    collected.push({ sequence: frame.sequence, phase: frame.job.phase });
  }
  assert.equal(capture.watchJobId, 'job-1');
  assert.deepEqual(collected, [
    { sequence: 1, phase: 'download' },
    { sequence: 2, phase: 'installed' },
  ]);
});

// ── update ─────────────────────────────────────────────────────────────

test('update: forwards confirmed flag and decodes the update job', async () => {
  const { ctx, capture } = mockCtx({
    updateApp: async (request) => {
      capture.updateRequest = request;
      return {
        job: protoJob({
          kind: AppLifecycleJobKind.UPDATE,
          phase: AppInstallJobPhase.SWAP,
          previousVersion: '1.0.0',
          installedVersion: '1.1.0',
        }),
      };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const job = await module.update({ appId: 'app-1', confirmed: true });
  assert.deepEqual(capture.updateRequest, { appId: 'app-1', confirmed: true });
  assert.equal(job.kind, 'update');
  assert.equal(job.phase, 'swap');
  assert.equal(job.previousVersion, '1.0.0');
});

// ── healthRepair ───────────────────────────────────────────────────────

test('healthRepair: maps each admitted action token to its proto enum', async () => {
  const cases: Array<{
    action: 'cancel' | 'retry' | 'repair' | 'reinstall';
    proto: AppHealthRepairAction;
  }> = [
    { action: 'cancel', proto: AppHealthRepairAction.CANCEL },
    { action: 'retry', proto: AppHealthRepairAction.RETRY },
    { action: 'repair', proto: AppHealthRepairAction.REPAIR },
    { action: 'reinstall', proto: AppHealthRepairAction.REINSTALL },
  ];
  for (const { action, proto } of cases) {
    const { ctx, capture } = mockCtx({
      healthRepairApp: async (request) => {
        capture.healthRepairRequest = request;
        return { job: protoJob({ kind: AppLifecycleJobKind.REPAIR }) };
      },
    });
    const module = createRuntimeAppLifecycleModule({ ctx });
    const job = await module.healthRepair({ appId: 'app-1', action, jobId: 'job-1' });
    assert.deepEqual(capture.healthRepairRequest, {
      appId: 'app-1',
      action: proto,
      jobId: 'job-1',
    });
    assert.equal(job.kind, 'repair');
  }
});

test('healthRepair: rejects an action outside the four admitted tokens', async () => {
  const { ctx } = mockCtx({});
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () =>
      module.healthRepair({
        appId: 'app-1',
        action: 'force' as unknown as 'cancel',
      }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_REPAIR_ACTION_INVALID,
  );
});

test('healthRepair: defaults jobId to empty when omitted', async () => {
  const { ctx, capture } = mockCtx({
    healthRepairApp: async (request) => {
      capture.healthRepairRequest = request;
      return { job: protoJob({ kind: AppLifecycleJobKind.REPAIR }) };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  await module.healthRepair({ appId: 'app-1', action: 'retry' });
  assert.deepEqual(capture.healthRepairRequest, {
    appId: 'app-1',
    action: AppHealthRepairAction.RETRY,
    jobId: '',
  });
});

// ── open ───────────────────────────────────────────────────────────────

test('open: forwards the explicit app-launch scope and decodes a launched projection', async () => {
  const { ctx, capture } = mockCtx({
    openApp: async (request) => {
      capture.openRequest = request;
      return {
        projection: {
          appId: 'app-1',
          state: AppOpenState.LAUNCHED,
          reachedStep: AppOpenFlowStep.LAUNCH,
          launched: true,
          activeVersion: '1.0.0',
          scope: { kind: 'app', ownerId: 'app-1', surfaceId: '' },
          reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
          detail: '',
        },
      };
    },
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const projection = await module.open({
    appId: 'app-1',
    scope: { kind: 'app', ownerId: 'app-1' },
  });
  assert.deepEqual(capture.openRequest, {
    appId: 'app-1',
    scope: { kind: 'app', ownerId: 'app-1', surfaceId: '' },
  });
  assert.equal(projection.state, 'launched');
  assert.equal(projection.launched, true);
  assert.equal(projection.reachedStep, 'launch');
  assert.equal(projection.activeVersion, '1.0.0');
  assert.deepEqual(projection.scope, { kind: 'app', ownerId: 'app-1' });
});

test('open: decodes a blocked projection with its typed reason and step', async () => {
  const { ctx } = mockCtx({
    openApp: async () => ({
      projection: {
        appId: 'app-1',
        state: AppOpenState.BLOCKED,
        reachedStep: AppOpenFlowStep.VERIFY_PACKAGE,
        launched: false,
        activeVersion: '',
        scope: { kind: 'app', ownerId: 'app-1', surfaceId: '' },
        reasonCode: RuntimeReasonCode.APP_OPEN_PACKAGE_NOT_VERIFIED,
        detail: 'app has no active release',
      },
    }),
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  const projection = await module.open({
    appId: 'app-1',
    scope: { kind: 'app', ownerId: 'app-1' },
  });
  assert.equal(projection.state, 'blocked');
  assert.equal(projection.launched, false);
  assert.equal(projection.reachedStep, 'verify_package');
  assert.equal(projection.reasonCode, 'APP_OPEN_PACKAGE_NOT_VERIFIED');
});

test('open: rejects a missing scope ref before any runtime call', async () => {
  const { ctx, capture } = mockCtx({});
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () =>
      module.open(
        { appId: 'app-1' } as unknown as {
          appId: string;
          scope: { kind: 'app'; ownerId: string };
        },
      ),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
  );
  assert.equal(capture.openRequest, undefined);
});

test('open: rejects a scope whose ownerId does not equal the opened appId', async () => {
  const { ctx, capture } = mockCtx({});
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () =>
      module.open({ appId: 'app-1', scope: { kind: 'app', ownerId: 'app-2' } }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
  );
  assert.equal(capture.openRequest, undefined);
});

test('open: fail-closes when a blocked projection omits its reason code', async () => {
  const { ctx } = mockCtx({
    openApp: async () => ({
      projection: {
        appId: 'app-1',
        state: AppOpenState.BLOCKED,
        reachedStep: AppOpenFlowStep.VERIFY_PERMISSIONS,
        launched: false,
        activeVersion: '',
        scope: { kind: 'app', ownerId: 'app-1', surfaceId: '' },
        reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
        detail: '',
      },
    }),
  });
  const module = createRuntimeAppLifecycleModule({ ctx });
  await assert.rejects(
    () => module.open({ appId: 'app-1', scope: { kind: 'app', ownerId: 'app-1' } }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});
