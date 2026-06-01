import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  PRODUCT_CONTROL_STATES,
  firstRunScreenForProductControlState,
  isDegradedProductControlState,
  isProductControlPhaseTransient,
  isRepairRoutedProductControlState,
  parseProductControlSelectedDataRootProjection,
  parseProductControlRecordProjection,
  productControlRecordUnavailableProjection,
  productControlSelectedDataRootUnavailableProjection,
  projectProductControlStorageDirs,
  projectProductControlAdmission,
  type ProductControlState,
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

test('product-control parser and recovery mapping are total over admitted states', () => {
  for (const state of PRODUCT_CONTROL_STATES) {
    const parsed = parseProductControlRecordProjection(record(state));
    assert.equal(parsed.state, state);
    assert.equal(parsed.record?.state, state);
    assert.equal(typeof PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[state], 'string');
    assert.ok(PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[state].startsWith('Support.'));
  }
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
