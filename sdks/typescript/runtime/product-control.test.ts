import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_FIRST_RUN_PHASES,
  NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  NIMI_PRODUCT_CONTROL_STATES,
  NIMI_PRODUCT_DATA_ROOT_STATUSES,
  admitNimiRuntimeProductControlReadyForUse,
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
  selectNimiRuntimeProductControlDataRoot,
  type NimiProductControlState,
  type NimiProductDataRootStatus,
  type NimiRuntimeProductControlClientFor,
} from './index';
import { ReasonCode } from '../types';

test('Runtime product-control projection parses Product Control-only first-run truth', () => {
  const projection = parseNimiProductControlProjectionJson(productControlEnvelope('data_root_selected'));
  const storageDirs = projectNimiProductControlStorageDirs({
    path: projection.path,
    exists: projection.exists,
    state: projection.state,
    dataRoot: projection.record?.dataRoot ?? null,
    error: projection.error,
  });

  assert.deepEqual(projection.record?.firstRun, { completed: false, completedAt: null });
  assert.deepEqual(projectNimiProductControlFirstRunScreen(projection.state), {
    kind: 'phase',
    phase: 'storage',
  });
  assert.deepEqual(projectNimiProductControlAdmission(projection.state), {
    kind: 'first-run',
    state: 'data_root_selected',
  });
  assert.equal(NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY.data_root_selected, 'Support.recoveryStateDataRootSelected');
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

test('Runtime product-control client exposes only active Product Control operations', async () => {
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
      async admitProductControlReadyForUse(request: unknown, options?: unknown) {
        calls.push({ method: 'admit', request, options });
        return productControlEnvelope('ready_for_use');
      },
    },
  } as NimiRuntimeProductControlClientFor<'getProductControlRecord'>
    & NimiRuntimeProductControlClientFor<'getProductControlSelectedDataRoot'>
    & NimiRuntimeProductControlClientFor<'ensureProductControlRecordCreated'>
    & NimiRuntimeProductControlClientFor<'selectProductControlDataRoot'>
    & NimiRuntimeProductControlClientFor<'admitProductControlReadyForUse'>;

  assert.equal((await getNimiRuntimeProductControlRecord(client, { callOptions })).state, 'ready_for_use');
  assert.equal((await getNimiRuntimeProductControlSelectedDataRoot(client, { callOptions })).dataRoot?.path, '/tester/nimi-data');
  assert.equal((await ensureNimiRuntimeProductControlRecordCreated(client, { callOptions })).state, 'data_root_missing');
  assert.equal((await selectNimiRuntimeProductControlDataRoot(client, { dataRoot: '/selected' }, { callOptions })).state, 'data_root_selected');
  assert.equal((await admitNimiRuntimeProductControlReadyForUse(client, { callOptions })).state, 'ready_for_use');

  assert.deepEqual(calls.map((call) => [call.method, call.request, call.options]), [
    ['get', {}, callOptions],
    ['selected-root', {}, callOptions],
    ['ensure', {}, callOptions],
    ['select-root', { dataRoot: '/selected' }, callOptions],
    ['admit', {}, callOptions],
  ]);
});

test('Runtime product-control projection covers the closed seven-state lifecycle', () => {
  const expectedScreens: Record<NimiProductControlState, ReturnType<typeof projectNimiProductControlFirstRunScreen>> = {
    not_logged_in: { kind: 'terminal', screen: 'login' },
    config_missing: { kind: 'phase', phase: 'storage' },
    data_root_missing: { kind: 'phase', phase: 'storage' },
    data_root_selected: { kind: 'phase', phase: 'storage' },
    repair_required: { kind: 'terminal', screen: 'repair' },
    blocked: { kind: 'terminal', screen: 'blocked' },
    ready_for_use: { kind: 'terminal', screen: 'ready' },
  };

  assert.deepEqual(NIMI_FIRST_RUN_PHASES, ['storage']);
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
  assert.equal(isNimiProductControlPhaseTransient('data_root_selected'), false);

  const expectedStatuses: readonly NimiProductDataRootStatus[] = ['selected', 'ready', 'repair_required'];
  assert.deepEqual(NIMI_PRODUCT_DATA_ROOT_STATUSES, expectedStatuses);
  for (const status of NIMI_PRODUCT_DATA_ROOT_STATUSES) {
    assert.equal(isNimiProductDataRootStatus(` ${status} `), true);
    assert.equal(parseNimiProductDataRootStatus(status), status);
  }
});

test('Runtime product-control storage projection preserves platform path separators', () => {
  assert.deepEqual(projectNimiProductControlStorageDirs({
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
  }), {
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

test('Runtime product-control parsers fail closed on retired state and firstRun fields', () => {
  assert.equal(parseNimiProductControlRecord(null), null);
  assert.deepEqual(projectUnavailableNimiProductControlRecord('offline'), {
    path: '', exists: false, state: 'config_missing', record: null, error: 'offline',
  });
  assert.deepEqual(projectUnavailableNimiProductControlSelectedDataRoot('offline'), {
    path: '', exists: false, state: 'config_missing', dataRoot: null, error: 'offline',
  });
  const parsedRecord = parseNimiProductControlRecordProjection(JSON.parse(productControlEnvelope('ready_for_use').json));
  assert.deepEqual(parsedRecord.record?.firstRun, {
    completed: true,
    completedAt: '2026-06-01T00:00:00.000Z',
  });
  const restartProjection = parseNimiProductControlRecordProjection({
    ...JSON.parse(productControlEnvelope('data_root_selected').json),
    configMutation: {
      disposition: 'restart_required',
      reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
      actionHint: 'request_typed_runtime_restart',
    },
  });
  assert.equal(restartProjection.configMutation?.reasonCode, ReasonCode.CONFIG_RESTART_REQUIRED);
  assert.equal(parseNimiProductControlSelectedDataRootProjection(JSON.parse(selectedDataRootEnvelope('ready_for_use').json)).dataRoot?.status, 'ready');
  assert.equal(parseNimiProductControlProjectionJson(productControlEnvelope('ready_for_use')).state, 'ready_for_use');
  assert.equal(parseNimiProductControlSelectedDataRootProjectionJson(selectedDataRootEnvelope('ready_for_use')).state, 'ready_for_use');

  assert.throws(() => parseNimiProductControlState('local_ai_ready'), hasReasonCode('SDK_PRODUCT_CONTROL_STATE_INVALID'));
  assert.throws(() => parseNimiProductDataRootStatus('pending'), hasReasonCode('SDK_PRODUCT_CONTROL_DATA_ROOT_STATUS_INVALID'));
  assert.throws(() => parseNimiProductControlProjectionJson({ json: '' }), hasReasonCode('SDK_PRODUCT_CONTROL_JSON_MISSING'));
  assert.throws(() => parseNimiProductControlSelectedDataRootProjectionJson({ json: '' }), hasReasonCode('SDK_PRODUCT_CONTROL_DATA_ROOT_JSON_MISSING'));
  assert.throws(
    () => parseNimiProductControlRecord({
      ...JSON.parse(productControlEnvelope('data_root_selected').json).record,
      firstRun: { completed: false, completedAt: null, installLevel: 'minimal' },
    }),
    hasReasonCode('SDK_PRODUCT_CONTROL_FIRST_RUN_INVALID'),
  );
  assert.throws(
    () => parseNimiProductControlRecord({
      ...JSON.parse(productControlEnvelope('ready_for_use').json).record,
      firstRun: { completed: false, completedAt: null },
    }),
    hasReasonCode('SDK_PRODUCT_CONTROL_FIRST_RUN_INVALID'),
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
        dataRoot: state === 'config_missing' || state === 'data_root_missing' ? null : {
          path: '/tester/nimi-data',
          status: state === 'ready_for_use' ? 'ready' : 'selected',
          selectedAt: '2026-06-01T00:00:00.000Z',
          verifiedAt: '2026-06-01T00:00:00.000Z',
          selectedAtUnixMs: 1,
          verifiedAtUnixMs: 1,
        },
        firstRun: {
          completed: state === 'ready_for_use',
          completedAt: state === 'ready_for_use' ? '2026-06-01T00:00:00.000Z' : null,
        },
        pointers: {},
        repair: { required: state === 'repair_required' },
      },
      error: null,
    }),
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
        status: state === 'ready_for_use' ? 'ready' : 'selected',
        selectedAt: '2026-06-01T00:00:00.000Z',
        verifiedAt: '2026-06-01T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
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
