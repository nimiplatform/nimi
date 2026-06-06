import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const localRuntimeOsHelpersPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/bridge/runtime-bridge/local-runtime-os-helpers.ts',
);
const localModelCenterPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center.tsx',
);
const localModelCenterRuntimeStatePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.ts',
);
const localModelCenterUnregisteredAssetsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-unregistered-assets.ts',
);
const localModelCenterSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections.tsx',
);
const localModelCenterCatalogSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-catalog-sections.tsx',
);
const localModelCenterProgressSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-progress-sections.tsx',
);
const localModelCenterHelpersPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-helpers.tsx',
);
const localModelCenterImportActionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-import-actions.ts',
);

const localRuntimeOsHelpersSource = readFileSync(localRuntimeOsHelpersPath, 'utf-8');
const localModelCenterImportActionsSource = readFileSync(localModelCenterImportActionsPath, 'utf-8');
const localModelCenterSource = [
  localModelCenterPath,
  localModelCenterRuntimeStatePath,
  localModelCenterUnregisteredAssetsPath,
]
  .map((filePath) => readFileSync(filePath, 'utf-8'))
  .join('\n');
const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const localModelCenterCatalogSectionsSource = [
  localModelCenterCatalogSectionsPath,
  localModelCenterProgressSectionsPath,
]
  .map((filePath) => readFileSync(filePath, 'utf-8'))
  .join('\n');
const localModelCenterHelpersSource = readFileSync(localModelCenterHelpersPath, 'utf-8');

test('local runtime exposes unified asset intake command surface', () => {
  assert.match(localRuntimeOsHelpersSource, /runtime_local_pick_asset_manifest_path/);
  assert.doesNotMatch(localRuntimeOsHelpersSource, /runtime_local_assets_scan_unregistered/);
});

test('Desktop local runtime alias is absent after SDK facade extraction', () => {
  assert.equal(existsSync(path.resolve(process.cwd(), 'src/runtime/local-runtime/index.ts')), false);
  assert.equal(existsSync(path.resolve(process.cwd(), 'src/runtime/local-runtime/commands.ts')), false);
});

test('local model center renders a unified unregistered assets review lane', () => {
  assert.match(localModelCenterSectionsSource, /Unregistered Assets/);
  assert.match(localModelCenterSectionsSource, /Discovered assets stay pending until you choose Import/);
  assert.match(localModelCenterSectionsSource, /LocalModelCenterUnregisteredAssetsSection/);
  assert.match(localModelCenterSectionsSource, /Review needed/);
});

test('runtime state refreshes unified unregistered assets without passive auto-import mutation', () => {
  assert.match(localModelCenterSource, /scanUnregisteredAssets\(\)/);
  assert.match(localModelCenterSource, /refreshUnregisteredAssets/);
  assert.doesNotMatch(localModelCenterSource, /scheduleAutoImportAttempt/);
  assert.doesNotMatch(localModelCenterSource, /asset\.autoImportable/);
  assert.doesNotMatch(localModelCenterSource, /phase:auto-import:failed/);
  assert.match(localModelCenterImportActionsSource, /importActions\.importAssetFromPath|const importAssetFromPath = useCallback/);
  assert.doesNotMatch(localModelCenterSource, /\.catch\(\(\) => undefined\)/);
});

test('unregistered model imports use orphan scaffold for all kinds while picked files stay on direct import', () => {
  assert.match(localModelCenterImportActionsSource, /runtimeConfigLocalModelCenterClient\.scaffoldOrphanAsset\(\{/);
  assert.doesNotMatch(localModelCenterImportActionsSource, /const preflightImportPlan = useCallback/);
  assert.doesNotMatch(localModelCenterImportActionsSource, /runtimeConfigLocalModelCenterClient\.resolveInstallPlan\(\{/);
  assert.doesNotMatch(localModelCenterImportActionsSource, /planBlocksCanonicalImageImport/);
  assert.match(localModelCenterImportActionsSource, /importManagedModelAssetFromPath\(assetPath, declaration, endpoint\)/);
  assert.match(localModelCenterImportActionsSource, /await runtimeConfigLocalModelCenterClient\.importAssetFile\(\{/);
  assert.match(localModelCenterImportActionsSource, /const filePath = await pickLocalRuntimeAssetFile\(\)/);
});

test('asset kind helpers keep vae as a first-class passive asset', () => {
  assert.match(localModelCenterHelpersSource, /NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_IDS/);
  assert.match(localModelCenterHelpersSource, /formatNimiRuntimeLocalAssetKindLabel/);
});

test('verified asset tasks expose retry only for failed verified installs', () => {
  assert.match(localModelCenterCatalogSectionsSource, /task\.taskKind === 'verified-install'/);
  assert.match(localModelCenterCatalogSectionsSource, /Retry/);
  assert.match(localModelCenterCatalogSectionsSource, /props\.onRetryTask\(task\.templateId\)/);
});
