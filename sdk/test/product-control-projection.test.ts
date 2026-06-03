import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  PRODUCT_CONTROL_STATES,
  firstRunScreenForProductControlState,
  isDegradedProductControlState,
  isProductControlPhaseTransient,
  isRepairRoutedProductControlState,
  admitRuntimeProductControlReadyForUse,
  completeRuntimeProductControlFirstRunDeviceEnvironmentScan,
  ensureRuntimeProductControlRecordCreated,
  getRuntimeProductControlRecord,
  getRuntimeProductControlSelectedDataRoot,
  parseProductControlProjectionJson,
  parseProductControlSelectedDataRootProjectionJson,
  parseProductControlSelectedDataRootProjection,
  parseProductControlRecordProjection,
  productControlRecordUnavailableProjection,
  productControlSelectedDataRootUnavailableProjection,
  projectProductControlStorageDirs,
  projectProductControlAdmission,
  reconcileRuntimeProductControlFirstRunSetupState,
  recordRuntimeProductControlAccountDefaultProfileEvidence,
  recordRuntimeProductControlFirstRunLocalAiReadyEvidence,
  selectRuntimeProductControlDataRoot,
  setRuntimeProductControlFirstRunInstallLevel,
  type ProductControlState,
  type RuntimeProductControlLocalClient,
} from '../src/index.js';

function record(state: ProductControlState) {
  return {
    path: '/tmp/home/.nimi/nimi.json',
    exists: true,
    state,
    record: {
      schemaVersion: 1,
      installId: 'install_1',
      productVersion: 'dev',
      state,
      dataRoot: {
        path: '/tmp/nimi-data',
        status: state === 'ready_for_use' ? 'ready' : 'selected',
        selectedAt: '2026-01-01T00:00:00.000Z',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      firstRun: {
        installLevel: 'minimal',
        aiProfileAlias: 'minimal',
        completed: state === 'ready_for_use',
        builtInAiConfigRefs: ['aiconfig/ref'],
      },
      pointers: {
        runtimeConfigPath: '/tmp/home/.nimi/runtime/config.json',
      },
      repair: {
        required: state === 'repair_required',
      },
    },
    error: null,
  };
}

function productControlEnvelope(state: ProductControlState) {
  return { json: JSON.stringify(record(state)) };
}

function selectedDataRootEnvelope() {
  return {
    json: JSON.stringify({
      path: '/tmp/home/.nimi/nimi.json',
      exists: true,
      state: 'data_root_selected',
      dataRoot: {
        path: '/tmp/nimi-data',
        status: 'selected',
        selectedAt: '2026-06-02T00:00:00.000Z',
        verifiedAt: '2026-06-02T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      error: null,
    }),
  };
}

test('product-control parser and recovery mapping are total over admitted states', () => {
  for (const state of PRODUCT_CONTROL_STATES) {
    const parsed = parseProductControlRecordProjection(record(state));
    assert.equal(parsed.state, state);
    assert.equal(parsed.record?.state, state);
    assert.equal(typeof PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[state], 'string');
    assert.ok(PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[state].startsWith('Support.'));
  }
});

test('product-control parser consumes Runtime JSON projection envelopes', () => {
  const projection = parseProductControlProjectionJson({
    json: JSON.stringify(record('data_root_missing')),
  });
  assert.equal(projection.state, 'data_root_missing');

  const selected = parseProductControlSelectedDataRootProjectionJson({
    json: JSON.stringify({
      path: '/tmp/home/.nimi/nimi.json',
      exists: true,
      state: 'data_root_selected',
      dataRoot: {
        path: '/tmp/nimi-data',
        status: 'selected',
        selectedAt: '2026-06-02T00:00:00.000Z',
        verifiedAt: '2026-06-02T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      error: null,
    }),
  });
  assert.equal(selected.dataRoot?.path, '/tmp/nimi-data');
});

test('Runtime product-control helpers submit typed RuntimeLocalService requests and parse envelopes', async () => {
  const calls: Array<{ method: string; request: unknown; timeoutMs: number | undefined }> = [];
  const capture = <TResponse>(method: string, request: unknown, timeoutMs: number | undefined, response: TResponse) => {
    calls.push({ method, request, timeoutMs });
    return Promise.resolve(response);
  };
  const local: RuntimeProductControlLocalClient = {
    getProductControlRecord: (request, options) =>
      capture('getProductControlRecord', request, options?.timeoutMs, productControlEnvelope('data_root_missing')),
    getProductControlSelectedDataRoot: (request, options) =>
      capture('getProductControlSelectedDataRoot', request, options?.timeoutMs, selectedDataRootEnvelope()),
    ensureProductControlRecordCreated: (request, options) =>
      capture('ensureProductControlRecordCreated', request, options?.timeoutMs, productControlEnvelope('data_root_missing')),
    selectProductControlDataRoot: (request, options) =>
      capture('selectProductControlDataRoot', request, options?.timeoutMs, productControlEnvelope('data_root_selected')),
    setProductControlFirstRunInstallLevel: (request, options) =>
      capture('setProductControlFirstRunInstallLevel', request, options?.timeoutMs, productControlEnvelope('ai_environment_unconfigured')),
    completeProductControlFirstRunDeviceEnvironmentScan: (request, options) =>
      capture('completeProductControlFirstRunDeviceEnvironmentScan', request, options?.timeoutMs, productControlEnvelope('ai_environment_unconfigured')),
    admitProductControlReadyForUse: (request, options) =>
      capture('admitProductControlReadyForUse', request, options?.timeoutMs, productControlEnvelope('ready_for_use')),
    recordProductControlAccountDefaultProfileEvidence: (request, options) =>
      capture('recordProductControlAccountDefaultProfileEvidence', request, options?.timeoutMs, productControlEnvelope('ai_environment_unconfigured')),
    recordProductControlFirstRunLocalAiReadyEvidence: (request, options) =>
      capture('recordProductControlFirstRunLocalAiReadyEvidence', request, options?.timeoutMs, productControlEnvelope('local_ai_ready')),
    reconcileProductControlFirstRunSetupState: (request, options) =>
      capture('reconcileProductControlFirstRunSetupState', request, options?.timeoutMs, productControlEnvelope('local_ai_profile_selected_assets_missing')),
  };

  assert.equal((await getRuntimeProductControlRecord(local, { callOptions: { timeoutMs: 123 } })).state, 'data_root_missing');
  assert.equal((await getRuntimeProductControlSelectedDataRoot({ local })).dataRoot?.path, '/tmp/nimi-data');
  assert.equal((await ensureRuntimeProductControlRecordCreated(local)).state, 'data_root_missing');
  assert.equal((await selectRuntimeProductControlDataRoot(local, { dataRoot: '/tmp/nimi-data' })).state, 'data_root_selected');
  assert.equal((await setRuntimeProductControlFirstRunInstallLevel(local, {
    installLevel: 'minimal',
    aiProfileAlias: 'local-speech-ready',
  })).state, 'ai_environment_unconfigured');
  assert.equal((await completeRuntimeProductControlFirstRunDeviceEnvironmentScan(local)).state, 'ai_environment_unconfigured');
  assert.equal((await recordRuntimeProductControlAccountDefaultProfileEvidence(local, {
    accountDefaultProfileEvidenceJson: '{"accountDefaultProfileRef":"ref"}',
  })).state, 'ai_environment_unconfigured');
  assert.equal((await recordRuntimeProductControlFirstRunLocalAiReadyEvidence(local, {
    runtimeBaselineRef: 'runtime-baseline',
    builtInAiConfigEvidenceJson: '{"builtInAiConfigRef":"ref"}',
    executionEvidenceRef: 'execution',
  })).state, 'local_ai_ready');
  assert.equal((await reconcileRuntimeProductControlFirstRunSetupState(local)).state, 'local_ai_profile_selected_assets_missing');
  assert.equal((await admitRuntimeProductControlReadyForUse(local, {
    accountDefaultProfileEvidenceJson: '{"accountDefaultProfileRef":"ref"}',
    builtInAiConfigEvidenceJson: '{"builtInAiConfigRef":"ref"}',
  })).state, 'ready_for_use');

  assert.deepEqual(calls, [
    { method: 'getProductControlRecord', request: {}, timeoutMs: 123 },
    { method: 'getProductControlSelectedDataRoot', request: {}, timeoutMs: undefined },
    { method: 'ensureProductControlRecordCreated', request: {}, timeoutMs: undefined },
    { method: 'selectProductControlDataRoot', request: { dataRoot: '/tmp/nimi-data' }, timeoutMs: undefined },
    {
      method: 'setProductControlFirstRunInstallLevel',
      request: { installLevel: 'minimal', aiProfileAlias: 'local-speech-ready' },
      timeoutMs: undefined,
    },
    { method: 'completeProductControlFirstRunDeviceEnvironmentScan', request: {}, timeoutMs: undefined },
    {
      method: 'recordProductControlAccountDefaultProfileEvidence',
      request: { accountDefaultProfileEvidenceJson: '{"accountDefaultProfileRef":"ref"}' },
      timeoutMs: undefined,
    },
    {
      method: 'recordProductControlFirstRunLocalAiReadyEvidence',
      request: {
        runtimeBaselineRef: 'runtime-baseline',
        builtInAiConfigEvidenceJson: '{"builtInAiConfigRef":"ref"}',
        executionEvidenceRef: 'execution',
      },
      timeoutMs: undefined,
    },
    { method: 'reconcileProductControlFirstRunSetupState', request: {}, timeoutMs: undefined },
    {
      method: 'admitProductControlReadyForUse',
      request: {
        accountDefaultProfileEvidenceJson: '{"accountDefaultProfileRef":"ref"}',
        builtInAiConfigEvidenceJson: '{"builtInAiConfigRef":"ref"}',
      },
      timeoutMs: undefined,
    },
  ]);
});

test('product-control screen and admission projections preserve fail-closed states', () => {
  assert.deepEqual(firstRunScreenForProductControlState('data_root_missing'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(firstRunScreenForProductControlState('data_root_selected'), { kind: 'phase', phase: 'device-scan' });
  assert.deepEqual(firstRunScreenForProductControlState('ai_environment_unconfigured'), { kind: 'phase', phase: 'local-ai' });
  assert.deepEqual(firstRunScreenForProductControlState('ready_for_use'), { kind: 'terminal', screen: 'ready' });
  assert.equal(isProductControlPhaseTransient('config_missing'), true);
  assert.equal(isProductControlPhaseTransient('data_root_selected'), false);

  assert.deepEqual(projectProductControlAdmission('ready_for_use'), { kind: 'ordinary-shell' });
  assert.deepEqual(projectProductControlAdmission('not_logged_in'), { kind: 'login' });
  assert.deepEqual(projectProductControlAdmission('repair_required'), { kind: 'first-run', state: 'repair_required' });
});

test('product-control recovery classification treats every non-ready state as degraded', () => {
  for (const state of PRODUCT_CONTROL_STATES) {
    assert.equal(isDegradedProductControlState(state), state !== 'ready_for_use');
  }
  assert.equal(isRepairRoutedProductControlState('repair_required'), true);
  assert.equal(isRepairRoutedProductControlState('blocked'), true);
  assert.equal(isRepairRoutedProductControlState('local_ai_ready'), false);
});

test('product-control unsupported projections remain fail-closed with explicit error', () => {
  const projection = productControlRecordUnavailableProjection('product_control_record_get requires Tauri runtime');
  assert.equal(projection.exists, false);
  assert.equal(projection.state, 'config_missing');
  assert.match(projection.error || '', /requires Tauri runtime/);
});

test('product-control storage dirs project platform storage layout without app-local path truth', () => {
  const projection = parseProductControlSelectedDataRootProjection({
    path: '/tmp/home/.nimi/nimi.json',
    exists: true,
    state: 'ready_for_use',
    dataRoot: {
      path: '/tmp/nimi-data/',
      status: 'ready',
      selectedAt: '2026-01-01T00:00:00.000Z',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 1,
    },
    error: null,
  });

  assert.deepEqual(projectProductControlStorageDirs(projection), {
    nimiDir: '/tmp/home/.nimi',
    nimiDataDir: '/tmp/nimi-data/',
    mediaCacheDir: '/tmp/nimi-data/cache/media',
    logsDir: '/tmp/nimi-data/logs',
    localModelsDir: '/tmp/nimi-data/models',
    localRuntimeStatePath: '/tmp/home/.nimi/runtime/local-state.json',
  });
});

test('product-control storage dirs preserve Windows separators and fail closed when unselected', () => {
  const windowsProjection = parseProductControlSelectedDataRootProjection({
    path: 'C:\\Users\\eric\\.nimi\\nimi.json',
    exists: true,
    state: 'data_root_selected',
    dataRoot: {
      path: 'D:\\NimiData\\',
      status: 'selected',
      selectedAt: '2026-01-01T00:00:00.000Z',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      selectedAtUnixMs: 1,
      verifiedAtUnixMs: 1,
    },
    error: null,
  });

  assert.deepEqual(projectProductControlStorageDirs(windowsProjection), {
    nimiDir: 'C:\\Users\\eric\\.nimi',
    nimiDataDir: 'D:\\NimiData\\',
    mediaCacheDir: 'D:\\NimiData\\cache\\media',
    logsDir: 'D:\\NimiData\\logs',
    localModelsDir: 'D:\\NimiData\\models',
    localRuntimeStatePath: 'C:\\Users\\eric\\.nimi\\runtime\\local-state.json',
  });

  assert.throws(
    () => projectProductControlStorageDirs(
      productControlSelectedDataRootUnavailableProjection('product_control_selected_data_root_get requires Tauri runtime'),
    ),
    /requires Tauri runtime/,
  );
});
