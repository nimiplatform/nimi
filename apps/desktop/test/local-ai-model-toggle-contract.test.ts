import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const catalogCardPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-catalog-card.tsx',
);
const controllerPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-panel-controller-install-actions-models.ts',
);
const localPagePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-page-local.tsx',
);
const localModelCenterStatePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.ts',
);
const localModelCenterImportActionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-import-actions.ts',
);
const localModelCenterImportFilePlanPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-import-file-plan.ts',
);
const localModelCenterSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections.tsx',
);
const localModelCenterUtilsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-model-center-utils.ts',
);
const localModelCenterProgressCachePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-progress-cache.ts',
);
const runtimeBootstrapRouteOptionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-options.ts',
);
const runtimeBootstrapHostCapabilitiesPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts',
);
const tauriCommandsPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/commands/commands_models_audit.rs',
);
const tauriModelIndexPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/model_index.rs',
);
const tauriLocalRuntimeModPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/mod.rs',
);

const catalogCardSource = readFileSync(catalogCardPath, 'utf-8');
const controllerSource = readFileSync(controllerPath, 'utf-8');
const localPageSource = readFileSync(localPagePath, 'utf-8');
const localModelCenterStateSource = readFileSync(localModelCenterStatePath, 'utf-8');
const localModelCenterImportActionsSource = readFileSync(localModelCenterImportActionsPath, 'utf-8');
const localModelCenterImportFilePlanSource = readFileSync(localModelCenterImportFilePlanPath, 'utf-8');
const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const localModelCenterUtilsSource = readFileSync(localModelCenterUtilsPath, 'utf-8');
const localModelCenterProgressCacheSource = readFileSync(localModelCenterProgressCachePath, 'utf-8');
const runtimeBootstrapRouteOptionsSource = readFileSync(runtimeBootstrapRouteOptionsPath, 'utf-8');
const runtimeBootstrapHostCapabilitiesSource = readFileSync(runtimeBootstrapHostCapabilitiesPath, 'utf-8');
const tauriCommandsSource = readFileSync(tauriCommandsPath, 'utf-8');
const tauriModelIndexSource = readFileSync(tauriModelIndexPath, 'utf-8');
const tauriLocalRuntimeModSource = readFileSync(tauriLocalRuntimeModPath, 'utf-8');

test('local model center installed list is status-only and no longer renders a lifecycle toggle', () => {
  assert.doesNotMatch(catalogCardSource, /<Toggle/);
  assert.doesNotMatch(catalogCardSource, /onStartModel:/);
  assert.doesNotMatch(catalogCardSource, /onStopModel:/);
  assert.doesNotMatch(catalogCardSource, /localModelLifecycleById:/);
  assert.doesNotMatch(catalogCardSource, /filteredInstalledModels/);
  assert.match(catalogCardSource, /filteredInstalledRunnableAssets/);
  assert.match(catalogCardSource, /asset\.status === 'installed'/);
  assert.match(catalogCardSource, /runtimeConfig\.localModelCenter\.installed/);
});

test('desktop local page no longer wires start\\/stop\\/restart product actions into local model center', () => {
  assert.doesNotMatch(localPageSource, /onStart=\{model\.startLocalModel\}/);
  assert.doesNotMatch(localPageSource, /onStop=\{model\.stopLocalModel\}/);
  assert.doesNotMatch(localPageSource, /onRestart=\{model\.restartLocalModel\}/);
});

test('local model center hides removed tombstones from installed sections and reinstall indexes', () => {
  assert.match(localModelCenterStateSource, /const visibleInstalledAssets = useMemo\(/);
  assert.match(localModelCenterStateSource, /sortedInstalledAssets\.filter\(\(asset\) => asset\.status !== 'removed'\)/);
  assert.match(localModelCenterStateSource, /visibleInstalledAssets\.filter\(\(asset\) => RUNNABLE_ASSET_KINDS\.has\(asset\.kind\)\)/);
  assert.match(localModelCenterStateSource, /new Map\(visibleInstalledAssets\.map\(\(asset\) => \[toCanonicalLocalLookupKey\(asset\.assetId\), asset\] as const\)\)/);
});

test('dismissed transfer sessions persist across renderer reloads', () => {
  assert.match(localModelCenterProgressCacheSource, /DISMISSED_SESSION_STORAGE_KEY = 'nimi\.runtime\.local-model-center\.dismissed-transfer-sessions\.v1'/);
  assert.match(localModelCenterProgressCacheSource, /loadStorageJsonFrom\(resolveStorage\(\), DISMISSED_SESSION_STORAGE_KEY\)/);
  assert.match(localModelCenterProgressCacheSource, /saveStorageJsonTo\(resolveStorage\(\), DISMISSED_SESSION_STORAGE_KEY,/);
  assert.match(localModelCenterProgressCacheSource, /const dismissedSessionIdsCache = new Set<string>\(loadDismissedSessionIds\(\)\)/);
  assert.match(localModelCenterProgressCacheSource, /persistDismissedSessionIds\(dismissedSessionIdsCache\)/);
});

test('local route options consume runtime node adapter truth without image-specific adapter overrides', () => {
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /function localAssetRequiresManagedLlamaImageAdapter\(/);
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /function localRouteAdapterForAsset\(/);
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /item\.engineConfig\?\.backend/);
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /String\(item\.preferredEngine \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'llama'/);
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /adapter: String\(nodeByProvider\.get\(normalizeLocalEngine\(item\.engine\)\)\?\.adapter \|\| ''\)\.trim\(\) \|\| undefined/);
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /function defaultLocalAdapter\(/);
});

test('local route options preserve per-asset endpoint instead of falling back to global runtime endpoint', () => {
  assert.match(runtimeBootstrapRouteOptionsSource, /endpoint: String\(item\.endpoint \|\| snapshotModel\?\.endpoint \|\| ''\)\.trim\(\) \|\| undefined/);
  assert.match(
    readFileSync(
      path.resolve(
        process.cwd(),
        'src/runtime/local-runtime/parsers.ts',
      ),
      'utf-8',
    ),
    /endpoint: asString\(record\.endpoint\) \|\| undefined/,
  );
  assert.match(
    readFileSync(
      path.resolve(
        process.cwd(),
        'src/runtime/local-runtime/parsers.ts',
      ),
      'utf-8',
    ),
    /engineRuntimeMode: record\.engineRuntimeMode == null\s*\?\s*undefined\s*:\s*normalizeEngineRuntimeMode\(record\.engineRuntimeMode\)/,
  );
});

test('local route hydration prefers fresh local model adapter over stale binding adapter', () => {
  assert.match(
    readFileSync(
      path.resolve(
        process.cwd(),
        'src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-routing.ts',
      ),
      'utf-8',
    ),
    /adapter: String\(localModel\.adapter \|\| binding\.adapter \|\| ''\)\.trim\(\) \|\| undefined/,
  );
});

test('runtime route resolve always rehydrates local bindings before resolving adapter and status', () => {
  assert.match(runtimeBootstrapHostCapabilitiesSource, /const needsLocalHydration = effectiveBinding\?\.source === 'local';/);
  assert.match(runtimeBootstrapHostCapabilitiesSource, /if \(options && effectiveBinding\.source === 'local'\) \{/);
  assert.doesNotMatch(runtimeBootstrapHostCapabilitiesSource, /localGoRuntimeStatus === 'removed'/);
});

test('manual import no longer injects managed media loopback defaults and can forward explicit endpoints', () => {
  assert.doesNotMatch(localModelCenterImportActionsSource, /defaultImportEndpointForAssetDeclaration/);
  assert.match(localModelCenterImportActionsSource, /endpoint: String\(endpoint \|\| ''\)\.trim\(\) \|\| undefined/);
  assert.match(
    readFileSync(
      path.resolve(
        process.cwd(),
        'src/runtime/local-runtime/commands-assets.ts',
      ),
      'utf-8',
    ),
    /endpoint: String\(options\?\.endpoint \|\| ''\)\.trim\(\) \|\| undefined/,
  );
});

test('import dialog exposes attached endpoint input when runtime requires it', () => {
  assert.match(localModelCenterSectionsSource, /endpointRequired: boolean/);
  assert.match(localModelCenterSectionsSource, /onEndpointChange: \(endpoint: string\) => void/);
  assert.match(localModelCenterSectionsSource, /const showEndpointField = props\.endpointRequired/);
  assert.match(localModelCenterSectionsSource, /endpointRequiredPlaceholder/);
  assert.match(localModelCenterImportFilePlanSource, /const \[importEndpointRequired, setImportEndpointRequired\] = useState\(false\)/);
  assert.match(localModelCenterImportFilePlanSource, /const \[importCompatibilityHint, setImportCompatibilityHint\] = useState\(''\)/);
  assert.match(localModelCenterImportFilePlanSource, /const \[importPlanAvailable, setImportPlanAvailable\] = useState\(true\)/);
  assert.match(localModelCenterImportFilePlanSource, /localRuntime\.resolveInstallPlan\(/);
  assert.match(localModelCenterUtilsSource, /export function planRequiresAttachedEndpointInput\(/);
  assert.match(localModelCenterUtilsSource, /plan\.engineRuntimeMode === 'attached-endpoint'/);
  assert.match(localModelCenterUtilsSource, /export function planBlockingHint\(/);
  assert.match(localModelCenterUtilsSource, /export function basenameFromRuntimePath\(/);
  assert.match(localModelCenterUtilsSource, /export function planBlocksCanonicalImageImport\(/);
  assert.match(localModelCenterUtilsSource, /export function planCanonicalImageCompatibilityHint\(/);
  assert.match(localModelCenterImportFilePlanSource, /canChooseImportFile = useMemo\(/);
  assert.match(localModelCenterSectionsSource, /compatibilityHint\?: string/);
  assert.match(localModelCenterImportFilePlanSource, /if \(importFileDeclaration\.assetKind === 'image'\) \{\s*setImportEndpointRequired\(false\);/s);
  assert.match(localModelCenterImportFilePlanSource, /setImportCompatibilityHint\(planCanonicalImageCompatibilityHint\(plan\)\)/);
  assert.match(localModelCenterImportFilePlanSource, /setImportPlanAvailable\(true\)/);
  assert.match(localModelCenterStateSource, /useLocalModelCenterImportFilePlan\(/);
});

test('unregistered assets import flow also captures attached endpoints for media and speech', () => {
  assert.match(localModelCenterSectionsSource, /endpointByPath: Record<string, string>/);
  assert.match(localModelCenterSectionsSource, /compatibilityHintByPath: Record<string, string>/);
  assert.match(localModelCenterSectionsSource, /importAllowedByPath: Record<string, boolean>/);
  assert.match(localModelCenterSectionsSource, /onEndpointChange: \(path: string, endpoint: string\) => void/);
  assert.match(localModelCenterSectionsSource, /const showEndpointField = endpointRequired \|\| Boolean\(endpointValue\) \|\| Boolean\(endpointHint\)/);
  assert.match(localModelCenterStateSource, /const \[unregisteredEndpointByPath, setUnregisteredEndpointByPath\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(localModelCenterStateSource, /const \[unregisteredEndpointRequiredByPath, setUnregisteredEndpointRequiredByPath\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(localModelCenterStateSource, /const \[unregisteredCompatibilityHintByPath, setUnregisteredCompatibilityHintByPath\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(localModelCenterStateSource, /const \[unregisteredImportAllowedByPath, setUnregisteredImportAllowedByPath\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(localModelCenterStateSource, /const previewFileName = basenameFromRuntimePath\(asset\.path\)/);
  assert.match(localModelCenterStateSource, /entry: previewFileName/);
  assert.match(localModelCenterStateSource, /files: \[previewFileName\]/);
  assert.match(localModelCenterStateSource, /const blocked = declaration\.assetKind === 'image' \? false : planBlocksCanonicalImageImport\(plan\)/);
  assert.match(localModelCenterStateSource, /\[asset\.path\]: declaration\.assetKind === 'image'/);
  assert.match(localModelCenterStateSource, /planCanonicalImageCompatibilityHint\(plan\)/);
  assert.match(localModelCenterStateSource, /importActions\.importAssetFromPath\(\s*assetPath,\s*declaration,\s*String\(unregisteredEndpointByPath\[assetPath\] \|\| ''\)\.trim\(\) \|\| undefined,\s*\)/s);
  assert.match(localModelCenterSectionsSource, /&& props\.importAllowedByPath\[asset\.path\] !== false/);
  assert.doesNotMatch(localModelCenterSectionsSource, /&& !compatibilityHint/);
});

test('scaffolded unregistered asset imports refresh installed asset sections immediately', () => {
  assert.match(localModelCenterImportActionsSource, /if \('scaffolded' in imported && imported\.scaffolded\) \{\s*await input\.props\.onDiscover\(\);\s*await input\.onRefreshAssetSections\(\);\s*await input\.onRefreshUnregisteredAssets\(\);\s*return;\s*\}/s);
});

test('installed attached-loopback assets expose a repair flow instead of forcing remove and reimport', () => {
  assert.match(catalogCardSource, /function assetNeedsAttachedEndpointRepair\(/);
  assert.match(catalogCardSource, /runtimeConfig\.localModelCenter\.repair/);
  assert.match(catalogCardSource, /props\.onRepairAsset\(asset\.localAssetId, repairEndpoint\)/);
  assert.match(localModelCenterStateSource, /const repairInstalledAsset = useCallback/);
  assert.match(localModelCenterStateSource, /Runtime manifest unavailable for asset repair/);
});

test('installed unhealthy assets surface runtime health detail in the model list', () => {
  assert.match(catalogCardSource, /asset\.status === 'unhealthy' && String\(asset\.healthDetail \|\| ''\)\.trim\(\)/);
  assert.match(catalogCardSource, /asset\.status === 'unhealthy' && String\(asset\.reasonCode \|\| ''\)\.trim\(\)/);
  assert.match(catalogCardSource, /text-\[var\(--nimi-status-danger\)\]/);
});

test('runtime local lifecycle controller remains available only as non-product maintenance surface', () => {
  assert.match(controllerSource, /localModelLifecycleById: Record<string, string>/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'starting', '', epoch\)/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'stopping', '', epoch\)/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'restarting', '', epoch\)/);
  assert.match(controllerSource, /setLifecycleState\(localModelId, 'syncing', '', epoch\)/);
  assert.match(controllerSource, /queueLifecycleReconcile\(/);
  assert.match(controllerSource, /runtimeConfig\.local\.startModelPending/);
  assert.match(controllerSource, /runtimeConfig\.local\.stopModelPending/);
  assert.match(controllerSource, /runtimeConfig\.local\.restartModelPending/);
});

test('local model tauri lifecycle commands run on a background blocking task', () => {
  assert.match(tauriCommandsSource, /async fn runtime_local_assets_start/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| \{/);
  assert.match(tauriCommandsSource, /runtime_start_asset_via_runtime_checked\(&app, &payload\.local_asset_id\)/);
  assert.match(tauriCommandsSource, /async fn runtime_local_assets_stop/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| runtime_stop_asset_via_runtime\(&payload\.local_asset_id\)\)/);
  assert.match(tauriCommandsSource, /async fn runtime_local_assets_health/);
  assert.match(tauriCommandsSource, /spawn_blocking\(move \|\| runtime_health_assets_via_runtime\(local_asset_id\.as_deref\(\)\)\)/);
  assert.doesNotMatch(tauriCommandsSource, /start_asset\(&app, &payload\.local_asset_id\)/);
  assert.doesNotMatch(tauriCommandsSource, /stop_asset\(&app, &payload\.local_asset_id\)/);
  assert.doesNotMatch(tauriCommandsSource, /health_assets\(&app, local_asset_id\.as_deref\(\)\)/);
});

test('local runtime cleanup removes host-local registry and supervisor modules from shipped paths', () => {
  assert.doesNotMatch(tauriLocalRuntimeModSource, /mod asset_registry;/);
  assert.doesNotMatch(tauriLocalRuntimeModSource, /mod supervisor;/);
  assert.match(tauriLocalRuntimeModSource, /#\[cfg\(test\)\]\s*mod engine_host;/);
  assert.match(tauriLocalRuntimeModSource, /#\[cfg\(test\)\]\s*mod engine_pack;/);
  assert.doesNotMatch(tauriModelIndexSource, /list_runnable_assets/);
  assert.match(tauriModelIndexSource, /load_state\(app\)/);
});
