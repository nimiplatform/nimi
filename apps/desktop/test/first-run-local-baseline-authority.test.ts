import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  loadPlatformAIProfileFactoryRows,
} from '@nimiplatform/sdk/platform-catalog';

const appRoutesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/routes/app-routes.tsx'),
  'utf8',
);
const firstRunGatePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/nimi-home/first-run-gate-panel.tsx'),
  'utf8',
);
const installLevelPolicySource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../sdk/src/platform-catalog/first-run.ts'),
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
const desktopProductControlDir = path.join(
  import.meta.dirname,
  '../src-tauri/src/desktop_product_control',
);
const desktopProductControlSource = [
  fs.readFileSync(
    path.join(import.meta.dirname, '../src-tauri/src/desktop_product_control.rs'),
    'utf8',
  ),
  ...fs
    .readdirSync(desktopProductControlDir)
    .filter((name) => name.endsWith('.rs'))
    .sort()
    .map((name) => fs.readFileSync(path.join(desktopProductControlDir, name), 'utf8')),
].join('\n');
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
  assert.match(productControlWorkflowSource, /from '@nimiplatform\/sdk\/platform-catalog'/);
  assert.doesNotMatch(productControlWorkflowSource, /install-level-policy/);
});

test('first-run wizard exposes data root selection, install levels, and no mark-ready shortcut', () => {
  // The redesigned wizard keeps every product-control bridge call and the
  // Minimal / Recommended install-level surface; it presents them through
  // the 3-phase wizard instead of the prior state-dump. The forbidden
  // mark-ready shortcut negative still holds.
  assert.match(productControlWorkflowSource, /ProductControlWorkflow/);
  assert.match(productControlWorkflowSource, /selectProductDataRoot/);
  assert.match(productControlWorkflowSource, /pickProductDataRootDirectory/);
  assert.match(productControlWorkflowSource, /setProductFirstRunInstallLevel/);
  assert.match(productControlWorkflowSource, /setProductFirstRunSetupState/);
  assert.match(productControlWorkflowSource, /startFirstRunMaterialization/);
  // The two admitted install levels are still the only ones presented.
  assert.match(productControlWorkflowSource, /'minimal'/);
  assert.match(productControlWorkflowSource, /'recommended'/);
  assert.match(productControlWorkflowSource, /first-run-install-level-/);
  assert.doesNotMatch(productControlWorkflowSource, /markProductReadyForUse/);
});

test('non-ready first-run gate renders only product-control setup, not ordinary Home surfaces', () => {
  assert.match(appRoutesSource, /features\/nimi-home\/first-run-gate-panel/);
  assert.match(appRoutesSource, /default:\s*mod\.FirstRunGatePanel/);
  assert.match(appRoutesSource, /<FirstRunGatePanel onReadyForUse=\{props\.onReadyForUse\} \/>/);
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

test('config_missing is an internal transient and does not expose the data-root picker', () => {
  // `config_missing` is a fast system state: the phase projection folds it
  // into the Storage phase as a transient (`isTransientSystemState`), so it
  // never presents the interactive folder-choose control. `data_root_missing`
  // is the first user-action data-root state.
  const phaseProjectionSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/first-run/first-run-phase-projection.ts'),
    'utf8',
  );
  assert.match(phaseProjectionSource, /config_missing/);
  assert.match(phaseProjectionSource, /isTransientSystemState/);
  assert.match(phaseProjectionSource, /data_root_missing/);
  // The Storage phase swaps to a transient loading affordance and hides the
  // folder-choose control when the phase is transient.
  const storagePhaseSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/first-run/phase-storage.tsx'),
    'utf8',
  );
  const workflowSource = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
    'utf8',
  );
  assert.match(storagePhaseSource, /props\.transient/);
  assert.match(storagePhaseSource, /first-run-storage-choose-folder/);
  assert.match(workflowSource, /ensureProductControlRecordCreated/);
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
  assert.match(desktopProductControlSource, /ready_for_use failed owner admission verification/);
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
  // `resolve_nimi_data_dir` — the readiness path — still requires the
  // user-selected product data root and never silently defaults.
  assert.match(desktopPathsSource, /selected_product_data_root/);
  // The OS-default `nimi_data` *proposal* helper is admitted as a first-run
  // pre-fill only: it resolves a `Nimi` home folder the user reviews and
  // confirms, never a silent `~/.nimi/data` readiness default.
  assert.match(desktopPathsSource, /fn default_data_root_proposal/);
  assert.doesNotMatch(desktopPathsSource, /join\(NIMI_DATA_DIR_NAME\)/);
});
