import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountAppInstallState,
  AccountAppInventoryState,
  AppPackageReadinessState,
  AppStorageState,
  ReasonCode as RuntimeReasonCode,
  type GetAccountAppInventoryRequest,
  type GetAppPackageReadinessRequest,
  type GetAppStorageRequest,
} from '../core-generated/runtime-typed-client';
import type { CoreStreamRequest, CoreTransport, CoreUnaryRequest } from '../types';
import {
  Runtime,
  createNimiRuntimeAppLifecycleClient,
  decodeNimiRuntimeAppPackageReadinessProjection,
  type NimiRuntimeAppLifecycleGeneratedClient,
} from './index';

function opaqueUnavailableProjection() {
  return {
    appId: '',
    releaseDescriptorRef: '',
    storagePolicyRef: '',
    expectedVersion: '',
    activeVersion: '',
    installedVersion: '',
    sha256: '',
    verificationState: '',
    state: AppPackageReadinessState.BLOCKED,
    reasonCode: RuntimeReasonCode.LOCAL_APP_OPERATION_UNAVAILABLE,
    detail: 'immutable_profile_unavailable',
  };
}

function createClientStub() {
  const accountCalls: GetAccountAppInventoryRequest[] = [];
  const storageCalls: GetAppStorageRequest[] = [];
  const readinessCalls: GetAppPackageReadinessRequest[] = [];
  const client: NimiRuntimeAppLifecycleGeneratedClient = {
    async getAccountAppInventory(request) {
      accountCalls.push(request);
      return {
        exists: true,
        record: {
          schemaVersion: 2,
          accountId: 'account-1',
          updatedAt: '2026-07-13T00:00:00.000Z',
          apps: [{
            appId: 'nimi.notes',
            accountState: AccountAppInventoryState.VERIFIED,
            installState: AccountAppInstallState.NOT_INSTALLED,
            lastOpenedAt: '',
            dataPolicy: 'principal-retained',
            verifiedAt: '',
            source: 'runtime-account',
            detail: '',
          }],
        },
        reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
        detail: '',
      };
    },
    async getAppStorage(request) {
      storageCalls.push(request);
      return {
        projection: {
          appId: request.appId,
          state: AppStorageState.READY,
          appRoot: '/runtime/private/app',
          activeReleaseRoot: '',
          durableDataRoot: '/runtime/private/data',
          cacheRoot: '/runtime/private/cache',
          tempRoot: '/runtime/private/temp',
          activeVersion: '',
          storagePolicyRef: 'principal-private',
          reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
          detail: '',
        },
      };
    },
    async getAppPackageReadiness(request) {
      readinessCalls.push(request);
      return { projection: opaqueUnavailableProjection() };
    },
  };
  return { client, accountCalls, storageCalls, readinessCalls };
}

test('Runtime app lifecycle facade exposes only 0K read projections', async () => {
  const { client, accountCalls, storageCalls, readinessCalls } = createClientStub();
  const lifecycle = createNimiRuntimeAppLifecycleClient({ client });

  const account = await lifecycle.accountInventory();
  assert.equal(account.record?.apps[0]?.installState, 'not-present');
  assert.deepEqual(accountCalls, [{}]);

  const storage = await lifecycle.storage({ appId: ' nimi.notes ' });
  assert.equal(storage.appId, 'nimi.notes');
  assert.deepEqual(storageCalls, [{ appId: 'nimi.notes' }]);

  const readiness = await lifecycle.packageReadiness();
  assert.deepEqual(readiness, {
    state: 'unavailable',
    reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
    detail: 'immutable_profile_unavailable',
  });
  assert.deepEqual(readinessCalls, [{ appId: '' }]);

  for (const retired of [
    'install',
    'uninstall',
    'getJob',
    'listJobs',
    'watchJobEvents',
    'update',
    'healthRepair',
  ]) {
    assert.equal(retired in lifecycle, false);
  }
});

test('package readiness decoder rejects positive or selector-bearing projections', () => {
  const decodeFailure = (error: unknown) =>
    (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED';

  assert.throws(
    () => decodeNimiRuntimeAppPackageReadinessProjection({
      ...opaqueUnavailableProjection(),
      state: AppPackageReadinessState.READY,
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppPackageReadinessProjection({
      ...opaqueUnavailableProjection(),
      appId: 'caller-selected',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppPackageReadinessProjection({
      ...opaqueUnavailableProjection(),
      releaseDescriptorRef: 'release:nimi.notes',
    }),
    decodeFailure,
  );
  assert.throws(
    () => decodeNimiRuntimeAppPackageReadinessProjection({
      ...opaqueUnavailableProjection(),
      reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    }),
    decodeFailure,
  );
});

class AppLifecycleFacadeTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.methodId === '/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness') {
      return { projection: opaqueUnavailableProjection() } as Response;
    }
    throw new Error(`unexpected unary ${request.methodId}`);
  }

  async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
    throw new Error('unexpected stream');
  }
}

test('Runtime facade sends selector-free readiness and blocks package lifecycle methods', async () => {
  const transport = new AppLifecycleFacadeTransport();
  const runtime = new Runtime({ transport, appId: 'nimi.desktop' });

  assert.equal((await runtime.appLifecycle.packageReadiness()).state, 'unavailable');
  assert.deepEqual(transport.unaryCalls[0]?.body, { appId: '' });

  for (const method of [
    'prepareAppLifecycleIntent',
    'getAppLifecycleIntentStatus',
    'installApp',
    'uninstallApp',
    'getAppInstallJob',
    'listAppInstallJobs',
    'watchAppInstallJobEvents',
    'updateApp',
    'healthRepairApp',
  ] as const) {
    await assert.rejects(
      (runtime.generated[method] as (...args: unknown[]) => Promise<unknown>)({}),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode
        === 'SDK_RUNTIME_APP_LIFECYCLE_TYPED_CLIENT_REQUIRED',
    );
  }
});
