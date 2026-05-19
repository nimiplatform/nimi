import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  loadPlatformAIProfileFactoryRows,
} from '../src/runtime/platform-catalog/index.js';

const homeBridgeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/nimi-home/nimi-home-live-bridge.ts'),
  'utf8',
);
const readinessTypesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/first-run/types.ts'),
  'utf8',
);
const productControlBridgeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/product-control.ts'),
  'utf8',
);
const desktopProductControlSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src-tauri/src/desktop_product_control.rs'),
  'utf8',
);
const desktopPathsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src-tauri/src/desktop_paths.rs'),
  'utf8',
);

test('first-run factory catalog projection exposes install levels and no cloud/hybrid first-run rows', () => {
  const rows = loadPlatformAIProfileFactoryRows();
  const firstRunRows = rows.filter((row) => row.applicableScopes.includes('first-run'));
  assert.ok(firstRunRows.length > 0, 'expected local first-run rows');
  for (const row of firstRunRows) {
    assert.ok(
      row.firstRunInstallLevels.includes('minimal') || row.firstRunInstallLevels.includes('recommended'),
      `${row.alias} must map to Minimal or Recommended`,
    );
    assert.notEqual(row.computePosture, 'cloud-only', `${row.alias} must not be cloud-only first-run`);
    assert.notEqual(row.routingPolicy, 'cloud-first', `${row.alias} must not be cloud-first first-run`);
    assert.notEqual(row.routingPolicy, 'hybrid-explicit', `${row.alias} must not be hybrid first-run`);
    assert.equal(row.capabilitySet.includes('video.generate'), false, `${row.alias} must not be video first-run`);
  }
  const cloudFirst = PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'cloud-first');
  const hybrid = PLATFORM_AI_PROFILE_FACTORY_ROWS.find((row) => row.alias === 'hybrid-recommended');
  assert.equal((cloudFirst?.applicableScopes as readonly string[] | undefined)?.includes('first-run'), false);
  assert.equal((hybrid?.applicableScopes as readonly string[] | undefined)?.includes('first-run'), false);
});

test('Nimi Home first-run selection is install-level aware and fail-closed against stale cloud rows', () => {
  assert.match(homeBridgeSource, /function isAdmittedFirstRunLocalBaseline/);
  assert.match(homeBridgeSource, /row\.firstRunInstallLevels/);
  assert.match(homeBridgeSource, /row\.computePosture === 'cloud-only'/);
  assert.match(homeBridgeSource, /row\.routingPolicy === 'cloud-first'/);
  assert.match(homeBridgeSource, /row\.routingPolicy === 'hybrid-explicit'/);
  assert.match(homeBridgeSource, /row\.capabilitySet\.includes\('video\.generate'\)/);
  assert.doesNotMatch(homeBridgeSource, /return rows\[0\] \?\? null/);
});

test('first-run readiness includes product control record and selected data root gates', () => {
  assert.match(readinessTypesSource, /productControlRecord/);
  assert.match(readinessTypesSource, /dataRoot/);
  assert.match(readinessTypesSource, /readyForUse: boolean/);
  assert.match(productControlBridgeSource, /ready_for_use/);
});

test('product control ready_for_use transition requires readiness evidence fields', () => {
  assert.match(desktopProductControlSource, /ProductReadyForUsePayload/);
  assert.match(desktopProductControlSource, /mark_ready_for_use/);
  assert.match(desktopProductControlSource, /account_default_profile_ref/);
  assert.match(desktopProductControlSource, /built_in_ai_config_refs/);
  assert.match(desktopProductControlSource, /runtime_baseline_ref/);
  assert.match(desktopProductControlSource, /execution_evidence_ref/);
  assert.match(desktopProductControlSource, /first_run\.completed = true/);
  assert.match(desktopProductControlSource, /ProductDataRootStatus::Ready/);
  assert.match(productControlBridgeSource, /markProductReadyForUse/);
});

test('Desktop product control record owns selected data root; desktop paths no longer default readiness to ~/.nimi/data', () => {
  assert.match(desktopProductControlSource, /PRODUCT_CONTROL_FILE_NAME: &str = "nimi\.json"/);
  assert.match(desktopProductControlSource, /ProductControlState::ConfigMissing/);
  assert.match(desktopProductControlSource, /select_product_data_root/);
  assert.match(desktopProductControlSource, /ensure_data_root_layout/);
  assert.match(desktopPathsSource, /selected_product_data_root/);
  assert.doesNotMatch(desktopPathsSource, /fn default_nimi_data_dir/);
  assert.doesNotMatch(desktopPathsSource, /join\(NIMI_DATA_DIR_NAME\)/);
});
