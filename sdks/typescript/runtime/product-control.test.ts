import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  NIMI_PRODUCT_CONTROL_STATES,
  NIMI_PRODUCT_DATA_ROOT_STATUSES,
  admitNimiRuntimeProductControlReadyForUse,
  completeNimiRuntimeProductControlFirstRunDeviceEnvironmentScan,
  ensureNimiRuntimeProductControlRecordCreated,
  getNimiRuntimeProductControlRecord,
  getNimiRuntimeProductControlSelectedDataRoot,
  isNimiProductControlDegradedState,
  isNimiProductControlPhaseTransient,
  isNimiProductControlRepairRoutedState,
  isNimiProductControlState,
  isNimiProductControlTransientState,
  isNimiProductDataRootStatus,
  parseNimiProductControlProjectionJson,
  parseNimiProductControlRecord,
  parseNimiProductControlRecordProjection,
  parseNimiProductControlSelectedDataRootProjection,
  parseNimiProductControlSelectedDataRootProjectionJson,
  parseNimiProductControlState,
  parseNimiProductDataRootStatus,
  projectNimiProductControlAdmission,
  projectNimiProductControlFirstRunScreen,
  projectNimiProductControlStorageDirs,
  projectUnavailableNimiProductControlRecord,
  projectUnavailableNimiProductControlSelectedDataRoot,
  reconcileNimiRuntimeProductControlFirstRunSetupState,
  selectNimiRuntimeProductControlDataRoot,
  setNimiRuntimeProductControlFirstRunInstallLevel,
  type NimiProductDataRootStatus,
  type NimiRuntimeProductControlClientFor,
  type NimiProductControlState,
} from './index';
import { ReasonCode } from '../types';

test('Runtime product-control projection parses first-run state and storage dirs', async () => {
  const state: NimiProductControlState = 'local_ai_assets_downloaded_environment_not_ready';
  const client: NimiRuntimeProductControlClientFor<'reconcileProductControlFirstRunSetupState'> = {
    local: {
      async reconcileProductControlFirstRunSetupState(request) {
        assert.deepEqual(request, {});
        return {
          json: JSON.stringify({
            path: '/tester/.nimi/nimi.json',
            exists: true,
            state,
            record: {
              schemaVersion: 1,
              installId: 'tester-install',
              productVersion: 'tester',
              state,
              dataRoot: {
                path: '/tester/nimi-data',
                status: 'selected',
                selectedAt: '2026-06-01T00:00:00.000Z',
                verifiedAt: '2026-06-01T00:00:00.000Z',
                selectedAtUnixMs: 1,
                verifiedAtUnixMs: 1,
              },
              firstRun: {
                installLevel: 'recommended',
                aiProfileAlias: 'recommended',
                completed: false,
              },
              pointers: {},
              repair: {
                required: false,
              },
            },
            error: null,
          }),
        };
      },
    },
  };

  const projection = await reconcileNimiRuntimeProductControlFirstRunSetupState(client);
  const storageDirs = projectNimiProductControlStorageDirs({
    path: projection.path,
    exists: projection.exists,
    state: projection.state,
    dataRoot: projection.record?.dataRoot ?? null,
    error: projection.error,
  });

  assert.equal(projectNimiProductControlFirstRunScreen(projection.state).kind, 'phase');
  assert.deepEqual(projectNimiProductControlFirstRunScreen(projection.state), { kind: 'phase', phase: 'setup' });
  assert.deepEqual(projectNimiProductControlAdmission(projection.state), { kind: 'first-run', state });
  assert.equal(isNimiProductControlDegradedState(projection.state), true);
  assert.equal(NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[state], 'Support.recoveryStateLocalAiAssetsDownloadedEnvironmentNotReady');
  assert.deepEqual(storageDirs, {
    dataRoot: '/tester/nimi-data',
    modelsDir: '/tester/nimi-data/models',
    dependenciesDir: '/tester/nimi-data/dependencies',
    environmentsDir: '/tester/nimi-data/environments',
    appsDir: '/tester/nimi-data/apps',
    accountsDir: '/tester/nimi-data/accounts',
    logsDir: '/tester/nimi-data/logs',
    auditDir: '/tester/nimi-data/audit',
  });
});

test('Runtime product-control client maps all local read and write operations', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: unknown }> = [];
  const callOptions = { metadata: { caller: 'test' } };
  const client = {
    local: {
      async getProductControlRecord(request: unknown, options?: unknown) {
        calls.push({ method: 'get', request, options });
        return productControlEnvelope('ready_for_use');
      },
      async getProductControlSelectedDataRoot(request: unknown, options?: unknown) {
        calls.push({ method: 'selected-root', request, options });
        return selectedDataRootEnvelope('ready_for_use');
      },
      async ensureProductControlRecordCreated(request: unknown, options?: unknown) {
        calls.push({ method: 'ensure', request, options });
        return productControlEnvelope('data_root_missing');
      },
      async selectProductControlDataRoot(request: unknown, options?: unknown) {
        calls.push({ method: 'select-root', request, options });
        return productControlEnvelope('data_root_selected');
      },
      async setProductControlFirstRunInstallLevel(request: unknown, options?: unknown) {
        calls.push({ method: 'install-level', request, options });
        return productControlEnvelope('local_ai_profile_selected_assets_missing');
      },
      async completeProductControlFirstRunDeviceEnvironmentScan(request: unknown, options?: unknown) {
        calls.push({ method: 'device-scan', request, options });
        return productControlEnvelope('local_ai_assets_downloaded_environment_not_ready');
      },
      async admitProductControlReadyForUse(request: unknown, options?: unknown) {
        calls.push({ method: 'admit', request, options });
        return productControlEnvelope('ready_for_use');
      },
      async reconcileProductControlFirstRunSetupState(request: unknown, options?: unknown) {
        calls.push({ method: 'reconcile', request, options });
        return productControlEnvelope('ready_for_use');
      },
    },
  } as NimiRuntimeProductControlClientFor<'getProductControlRecord'>
    & NimiRuntimeProductControlClientFor<'getProductControlSelectedDataRoot'>
    & NimiRuntimeProductControlClientFor<'ensureProductControlRecordCreated'>
    & NimiRuntimeProductControlClientFor<'selectProductControlDataRoot'>
    & NimiRuntimeProductControlClientFor<'setProductControlFirstRunInstallLevel'>
    & NimiRuntimeProductControlClientFor<'completeProductControlFirstRunDeviceEnvironmentScan'>
    & NimiRuntimeProductControlClientFor<'admitProductControlReadyForUse'>
    & NimiRuntimeProductControlClientFor<'reconcileProductControlFirstRunSetupState'>;

  assert.equal((await getNimiRuntimeProductControlRecord(client, { callOptions })).state, 'ready_for_use');
  assert.equal((await getNimiRuntimeProductControlSelectedDataRoot(client, { callOptions })).dataRoot?.path, '/tester/nimi-data');
  assert.equal((await ensureNimiRuntimeProductControlRecordCreated(client, { callOptions })).state, 'data_root_missing');
  assert.equal((await selectNimiRuntimeProductControlDataRoot(client, { dataRoot: '/selected' }, { callOptions })).state, 'data_root_selected');
  assert.equal((await setNimiRuntimeProductControlFirstRunInstallLevel(
    client,
    { installLevel: 'recommended', aiProfileAlias: 'balanced' },
    { callOptions },
  )).state, 'local_ai_profile_selected_assets_missing');
  assert.equal((await completeNimiRuntimeProductControlFirstRunDeviceEnvironmentScan(client, { callOptions })).state, 'local_ai_assets_downloaded_environment_not_ready');
  assert.equal((await admitNimiRuntimeProductControlReadyForUse(
    client,
    { callOptions },
  )).state, 'ready_for_use');
  assert.equal((await reconcileNimiRuntimeProductControlFirstRunSetupState(client, { callOptions })).state, 'ready_for_use');

  assert.deepEqual(calls.map((call) => [call.method, call.request, call.options]), [
    ['get', {}, callOptions],
    ['selected-root', {}, callOptions],
    ['ensure', {}, callOptions],
    ['select-root', { dataRoot: '/selected' }, callOptions],
    ['install-level', { installLevel: 'recommended', aiProfileAlias: 'balanced' }, callOptions],
    ['device-scan', {}, callOptions],
    ['admit', {}, callOptions],
    ['reconcile', {}, callOptions],
  ]);
});

test('Runtime product-control projection covers all admitted states and storage path branches', () => {
  const expectedScreens: Record<NimiProductControlState, ReturnType<typeof projectNimiProductControlFirstRunScreen>> = {
    not_logged_in: { kind: 'terminal', screen: 'login' },
    config_missing: { kind: 'phase', phase: 'storage' },
    data_root_missing: { kind: 'phase', phase: 'storage' },
    data_root_selected: { kind: 'phase', phase: 'device-scan' },
    ai_environment_unconfigured: { kind: 'phase', phase: 'local-ai' },
    local_ai_profile_selected_assets_missing: { kind: 'phase', phase: 'setup' },
    local_ai_profile_selected_environment_not_ready: { kind: 'phase', phase: 'setup' },
    local_ai_assets_downloaded_environment_not_ready: { kind: 'phase', phase: 'setup' },
    local_ai_ready: { kind: 'phase', phase: 'setup' },
    repair_required: { kind: 'terminal', screen: 'repair' },
    blocked: { kind: 'terminal', screen: 'blocked' },
    ready_for_use: { kind: 'terminal', screen: 'ready' },
  };

  assert.deepEqual([...NIMI_PRODUCT_CONTROL_STATES].sort(), Object.keys(expectedScreens).sort());
  for (const state of NIMI_PRODUCT_CONTROL_STATES) {
    assert.equal(isNimiProductControlState(` ${state} `), true);
    assert.equal(parseNimiProductControlState(state), state);
    assert.deepEqual(projectNimiProductControlFirstRunScreen(state), expectedScreens[state]);
    assert.equal(isNimiProductControlDegradedState(state), state !== 'ready_for_use');
    assert.equal(isNimiProductControlRepairRoutedState(state), state === 'repair_required' || state === 'blocked');
  }
  assert.deepEqual(projectNimiProductControlAdmission('ready_for_use'), { kind: 'ordinary-shell' });
  assert.deepEqual(projectNimiProductControlAdmission('not_logged_in'), { kind: 'login' });
  assert.equal(isNimiProductControlTransientState('config_missing'), true);
  assert.equal(isNimiProductControlPhaseTransient('data_root_missing'), false);

  const expectedDataRootStatuses: readonly NimiProductDataRootStatus[] = ['selected', 'ready', 'repair_required'];
  assert.deepEqual(NIMI_PRODUCT_DATA_ROOT_STATUSES, expectedDataRootStatuses);
  for (const status of NIMI_PRODUCT_DATA_ROOT_STATUSES) {
    assert.equal(isNimiProductDataRootStatus(` ${status} `), true);
    assert.equal(parseNimiProductDataRootStatus(status), status);
  }

  const windowsDirs = projectNimiProductControlStorageDirs({
    path: 'C:\\Users\\tester\\.nimi\\nimi.json',
    exists: true,
    state: 'ready_for_use',
    dataRoot: {
      path: 'D:\\NimiData\\',
      status: 'ready',
      selectedAt: '2026-06-05T00:00:00.000Z',
      verifiedAt: '2026-06-05T00:00:00.000Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 2,
    },
    error: null,
  });
  assert.deepEqual(windowsDirs, {
    dataRoot: 'D:\\NimiData\\',
    modelsDir: 'D:\\NimiData\\models',
    dependenciesDir: 'D:\\NimiData\\dependencies',
    environmentsDir: 'D:\\NimiData\\environments',
    appsDir: 'D:\\NimiData\\apps',
    accountsDir: 'D:\\NimiData\\accounts',
    logsDir: 'D:\\NimiData\\logs',
    auditDir: 'D:\\NimiData\\audit',
  });
  assert.throws(
    () => projectNimiProductControlStorageDirs(projectUnavailableNimiProductControlSelectedDataRoot('select a root first')),
    hasReasonCode('SDK_PRODUCT_CONTROL_STORAGE_ROOT_MISSING'),
  );
});

test('Runtime product-control parsers fail closed on invalid projection envelopes', () => {
  assert.equal(parseNimiProductControlRecord(null), null);
  assert.deepEqual(projectUnavailableNimiProductControlRecord('offline'), {
    path: '',
    exists: false,
    state: 'config_missing',
    record: null,
    error: 'offline',
  });
  assert.deepEqual(projectUnavailableNimiProductControlSelectedDataRoot('offline'), {
    path: '',
    exists: false,
    state: 'config_missing',
    dataRoot: null,
    error: 'offline',
  });
  const parsedRecord = parseNimiProductControlRecordProjection(JSON.parse(productControlEnvelope('ready_for_use').json));
  assert.equal(parsedRecord.state, 'ready_for_use');
  assert.equal(Object.hasOwn(parsedRecord, 'dataRootProposal'), false);
  assert.equal(Object.hasOwn(parsedRecord.record?.pointers ?? {}, 'runtimeConfigPath'), false);
  assert.equal(Object.hasOwn(parsedRecord.record?.pointers ?? {}, 'appRegistry'), false);
  assert.equal(Object.hasOwn(parsedRecord.record?.pointers ?? {}, 'appPackages'), false);
  const restartProjection = parseNimiProductControlRecordProjection({
    ...JSON.parse(productControlEnvelope('data_root_selected').json),
    configMutation: {
      disposition: 'restart_required',
      reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
      actionHint: 'request_typed_runtime_restart',
    },
  });
  assert.equal(restartProjection.configMutation?.reasonCode, ReasonCode.CONFIG_RESTART_REQUIRED);
  assert.equal(parseNimiProductControlSelectedDataRootProjection(JSON.parse(selectedDataRootEnvelope('ready_for_use').json)).dataRoot?.status, 'selected');
  assert.equal(parseNimiProductControlProjectionJson(productControlEnvelope('ready_for_use')).state, 'ready_for_use');
  assert.equal(parseNimiProductControlSelectedDataRootProjectionJson(selectedDataRootEnvelope('ready_for_use')).state, 'ready_for_use');

  assert.throws(
    () => parseNimiProductControlState('unknown'),
    hasReasonCode('SDK_PRODUCT_CONTROL_STATE_INVALID'),
  );
  assert.throws(
    () => parseNimiProductDataRootStatus('pending'),
    hasReasonCode('SDK_PRODUCT_CONTROL_DATA_ROOT_STATUS_INVALID'),
  );
  assert.throws(
    () => parseNimiProductControlProjectionJson({ json: '' }),
    hasReasonCode('SDK_PRODUCT_CONTROL_JSON_MISSING'),
  );
  assert.throws(
    () => parseNimiProductControlSelectedDataRootProjectionJson({ json: '' }),
    hasReasonCode('SDK_PRODUCT_CONTROL_DATA_ROOT_JSON_MISSING'),
  );
  assert.throws(
    () => parseNimiProductControlRecord({
      schemaVersion: 1,
      installId: 'tester',
      productVersion: 'tester',
      state: 'ready_for_use',
      dataRoot: null,
      firstRun: { installLevel: 'enterprise' },
      pointers: {},
      repair: {},
    }),
    hasReasonCode('SDK_PRODUCT_CONTROL_INSTALL_LEVEL_INVALID'),
  );
  assert.throws(
    () => parseNimiProductControlRecordProjection(null),
    hasReasonCode('SDK_PRODUCT_CONTROL_PAYLOAD_INVALID'),
  );
  assert.throws(
    () => parseNimiProductControlRecordProjection({
      path: '/tester/nimi.json',
      exists: true,
      state: 'data_root_selected',
      record: null,
      configMutation: {
        disposition: 'restart_required',
        reasonCode: ReasonCode.CONFIG_APPLIED,
        actionHint: 'continue_product_setup',
      },
      error: null,
    }),
    hasReasonCode('SDK_PRODUCT_CONTROL_CONFIG_MUTATION_INVALID'),
  );
});

function productControlEnvelope(state: NimiProductControlState) {
  return {
    json: JSON.stringify({
      path: '/tester/.nimi/nimi.json',
      exists: true,
      state,
      record: {
        schemaVersion: 1,
        installId: 'tester-install',
        productVersion: 'tester',
        state,
        dataRoot: {
          path: '/tester/nimi-data',
          status: 'selected',
          selectedAt: '2026-06-01T00:00:00.000Z',
          verifiedAt: '2026-06-01T00:00:00.000Z',
          selectedAtUnixMs: 1,
          verifiedAtUnixMs: 1,
        },
        firstRun: {
          installLevel: 'recommended',
          aiProfileAlias: 'recommended',
          completed: state === 'ready_for_use',
          completedAt: state === 'ready_for_use' ? '2026-06-01T00:00:00.000Z' : null,
        },
        pointers: {},
        repair: {
          required: false,
        },
      },
      error: null,
    }),
  };
}

function hasReasonCode(reasonCode: string): (error: unknown) => boolean {
  return (error: unknown) => {
    const shaped = error as { readonly reasonCode?: string; readonly code?: string };
    assert.equal(shaped.reasonCode ?? shaped.code, reasonCode);
    return true;
  };
}

function selectedDataRootEnvelope(state: NimiProductControlState) {
  return {
    json: JSON.stringify({
      path: '/tester/.nimi/nimi.json',
      exists: true,
      state,
      dataRoot: {
        path: '/tester/nimi-data',
        status: 'selected',
        selectedAt: '2026-06-01T00:00:00.000Z',
        verifiedAt: '2026-06-01T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      error: null,
    }),
  };
}
