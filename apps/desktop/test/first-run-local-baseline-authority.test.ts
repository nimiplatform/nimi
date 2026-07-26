import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isNimiProductControlTransientState } from '@nimiplatform/sdk/runtime';

const appRoutesSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/app-shell/routes/app-routes.tsx'),
  'utf8',
);
const firstRunGatePanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/nimi-home/first-run-gate-panel.tsx'),
  'utf8',
);
const productControlWorkflowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
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

test('Nimi Home first-run selection is install-level aware and fail-closed against stale cloud rows', () => {
  assert.match(productControlWorkflowSource, /from '@nimiplatform\/sdk\/app'/);
  assert.doesNotMatch(productControlWorkflowSource, /install-level-policy/);
});

test('first-run wizard exposes data root selection, install levels, and no mark-ready shortcut', () => {
  // The redesigned wizard keeps every product-control bridge call and the
  // Minimal / Recommended install-level surface; it presents them through
  // the 4-phase wizard instead of the prior state-dump. The forbidden
  // mark-ready shortcut negative still holds.
  assert.match(productControlWorkflowSource, /ProductControlWorkflow/);
  assert.match(productControlWorkflowSource, /firstRun\.selectDataRoot/);
  assert.match(productControlWorkflowSource, /firstRun\.pickDataRootDirectory/);
  assert.match(productControlWorkflowSource, /firstRun\.setInstallLevel/);
  assert.match(productControlWorkflowSource, /firstRun\.reconcileSetupState/);
  assert.match(productControlWorkflowSource, /firstRun\.startMaterialization/);
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
  assert.equal(isNimiProductControlTransientState('config_missing'), true);
  assert.equal(isNimiProductControlTransientState('data_root_missing'), false);
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
  assert.match(workflowSource, /firstRun\.ensureRecordCreated/);
  assert.match(
    desktopProductControlSource,
    /RUNTIME_LOCAL_ENSURE_PRODUCT_CONTROL_RECORD_CREATED_METHOD_ID/,
  );
});

test('first-run readiness includes product control record and selected data root gates', () => {
  for (const removed of [
    'types.ts',
    'readiness-projection.ts',
    'readiness-view.tsx',
    'discovery-projection.ts',
    'discovery-view.tsx',
    'library-projection.ts',
    'library-view.tsx',
  ]) {
    assert.equal(
      fs.existsSync(path.join(import.meta.dirname, '../src/shell/renderer/first-run', removed)),
      false,
      `${removed} must stay hard-cut after Product Control first-run admission`,
    );
  }
  assert.match(productControlBridgeSource, /ready_for_use/);
});

test('product control ready_for_use has no production renderer/Tauri admission shortcut', () => {
  assert.doesNotMatch(desktopProductControlSource, /ProductReadyForUsePayload/);
  assert.doesNotMatch(desktopProductControlSource, /mark_ready_for_use/);
  assert.doesNotMatch(desktopProductControlSource, /product_control_record_mark_ready_for_use/);
  assert.match(desktopProductControlSource, /RUNTIME_LOCAL_GET_PRODUCT_CONTROL_RECORD_METHOD_ID/);
  assert.doesNotMatch(desktopProductControlSource, /read_existing_record|write_record/);
  assert.doesNotMatch(productControlBridgeSource, /markProductReadyForUse/);
  assert.doesNotMatch(productControlBridgeSource, /product_control_record_mark_ready_for_use/);
  assert.match(productControlBridgeSource, /reconcileProductFirstRunSetupState/);
  assert.doesNotMatch(productControlBridgeSource, /setProductFirstRunSetupState/);
});

test('Desktop resolves selected data root through the same Runtime projection adapter in tests and production', () => {
  assert.match(
    desktopProductControlSource,
    /RUNTIME_LOCAL_GET_PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD_ID/,
  );
  assert.match(desktopProductControlSource, /nimi_data_root_from_projection/);
  assert.match(
    desktopProductControlSource,
    /ProductDataRootStatus::Selected \| ProductDataRootStatus::Ready/,
  );
  assert.match(desktopPathsSource, /runtime_validated_nimi_data_root/);
  assert.doesNotMatch(
    desktopPathsSource,
    /crate::desktop_product_control::selected_product_data_root\(\)/,
  );
  assert.doesNotMatch(desktopPathsSource, /default_data_root_proposal|join\("Nimi"\)|join\("data"\)/);
});
