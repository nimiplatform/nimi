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
const appRoutesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/routes/app-routes.tsx'),
  'utf8',
);
const firstRunGatePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/nimi-home/first-run-gate-panel.tsx'),
  'utf8',
);
const nimiHomePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/nimi-home/nimi-home-panel.tsx'),
  'utf8',
);
const installLevelPolicySource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/first-run/install-level-policy.ts'),
  'utf8',
);
const productControlWorkflowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
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
  assert.match(installLevelPolicySource, /function isAdmittedFirstRunLocalBaseline/);
  assert.match(installLevelPolicySource, /row\.firstRunInstallLevels/);
  assert.match(installLevelPolicySource, /row\.computePosture === 'cloud-only'/);
  assert.match(installLevelPolicySource, /row\.routingPolicy === 'cloud-first'/);
  assert.match(installLevelPolicySource, /row\.routingPolicy === 'hybrid-explicit'/);
  assert.match(installLevelPolicySource, /row\.capabilitySet\.includes\('video\.generate'\)/);
  assert.doesNotMatch(homeBridgeSource, /return rows\[0\] \?\? null/);
});

test('first-run workflow exposes product states, data root selection, install levels, and no mark-ready shortcut', () => {
  assert.match(productControlWorkflowSource, /ProductControlWorkflow/);
  assert.match(productControlWorkflowSource, /PRODUCT_COPY/);
  assert.match(productControlWorkflowSource, /selectProductDataRoot/);
  assert.match(productControlWorkflowSource, /setProductFirstRunInstallLevel/);
  assert.match(productControlWorkflowSource, /setProductFirstRunSetupState/);
  assert.match(productControlWorkflowSource, /startFirstRunMaterialization/);
  assert.match(productControlWorkflowSource, /product-first-run-install-level-\$\{installLevel\}/);
  assert.match(productControlWorkflowSource, /\(\['minimal', 'recommended'\] as const\)/);
  assert.match(productControlWorkflowSource, /product-first-run-materialization-start/);
  assert.doesNotMatch(productControlWorkflowSource, /markProductReadyForUse/);
});

test('non-ready first-run gate renders only product-control setup, not ordinary Home surfaces', () => {
  assert.match(appRoutesSource, /features\/nimi-home\/first-run-gate-panel/);
  assert.match(appRoutesSource, /default:\s*mod\.FirstRunGatePanel/);
  assert.match(appRoutesSource, /<FirstRunGatePanel \/>/);
  assert.match(firstRunGatePanelSource, /ProductControlWorkflow/);
  for (const forbidden of [
    /AgentChatReference/,
    /LibraryView/,
    /DiscoveryView/,
    /projectLibrary/,
    /projectDiscovery/,
    /useAppRegistryProjections/,
  ]) {
    assert.doesNotMatch(firstRunGatePanelSource, forbidden);
  }
});

test('ordinary Nimi Home does not mount mutable product-control workflow', () => {
  assert.doesNotMatch(nimiHomePanelSource, /ProductControlWorkflow/);
  assert.doesNotMatch(nimiHomePanelSource, /setProductFirstRunSetupState/);
  assert.doesNotMatch(nimiHomePanelSource, /setProductControl/);
  assert.match(nimiHomePanelSource, /FirstRunReadinessView/);
});

test('config_missing is internal and does not expose the data-root form', () => {
  assert.match(productControlWorkflowSource, /config_missing/);
  assert.doesNotMatch(productControlWorkflowSource, /state === 'config_missing'/);
  assert.match(productControlWorkflowSource, /state === 'data_root_missing'/);
  assert.match(desktopProductControlSource, /empty_record\(ProductControlState::DataRootMissing\)/);
});

test('first-run readiness includes product control record and selected data root gates', () => {
  assert.match(readinessTypesSource, /productControlRecord/);
  assert.match(readinessTypesSource, /dataRoot/);
  assert.match(readinessTypesSource, /readyForUse: boolean/);
  assert.match(productControlBridgeSource, /ready_for_use/);
});

test('product control ready_for_use has no production renderer/Tauri admission shortcut', () => {
  assert.doesNotMatch(desktopProductControlSource, /ProductReadyForUsePayload/);
  assert.doesNotMatch(desktopProductControlSource, /mark_ready_for_use/);
  assert.doesNotMatch(desktopProductControlSource, /product_control_record_mark_ready_for_use/);
  assert.match(desktopProductControlSource, /ready_for_use requires Runtime-owned admission verification/);
  assert.doesNotMatch(productControlBridgeSource, /markProductReadyForUse/);
  assert.doesNotMatch(productControlBridgeSource, /product_control_record_mark_ready_for_use/);
  assert.match(productControlBridgeSource, /Exclude<ProductControlState,[^>]*'local_ai_ready'/);
});

test('Desktop product control record owns selected data root; desktop paths no longer default readiness to ~/.nimi/data', () => {
  assert.match(desktopProductControlSource, /PRODUCT_CONTROL_FILE_NAME: &str = "nimi\.json"/);
  assert.match(desktopProductControlSource, /ConfigMissing/);
  assert.match(desktopProductControlSource, /empty_record\(ProductControlState::DataRootMissing\)/);
  assert.match(desktopProductControlSource, /select_product_data_root/);
  assert.match(desktopProductControlSource, /ensure_data_root_layout/);
  assert.match(desktopPathsSource, /selected_product_data_root/);
  assert.doesNotMatch(desktopPathsSource, /fn default_nimi_data_dir/);
  assert.doesNotMatch(desktopPathsSource, /join\(NIMI_DATA_DIR_NAME\)/);
});
