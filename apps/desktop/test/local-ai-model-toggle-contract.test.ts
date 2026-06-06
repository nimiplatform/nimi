import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const installedSectionPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-section.tsx',
);
const installedRowsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-rows.tsx',
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
const localModelCenterUnregisteredAssetsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-unregistered-assets.ts',
);
const localModelCenterInstalledAssetsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-installed-assets.ts',
);
const localModelCenterImportActionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-import-actions.ts',
);
const localModelCenterImportFilePlanPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-import-file-plan.ts',
);
const localModelCenterUseHelpersPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-helpers.ts',
);
const localModelCenterHelpersPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-helpers.tsx',
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
const runtimeConfigPanelEffectsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-panel-effects.ts',
);
const retiredRouteResolverFileName = ['runtime-bootstrap-route', 'resolvers.ts'].join('-');
const runtimeBootstrapRouteResolversPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/infra/bootstrap',
  retiredRouteResolverFileName,
);
const runtimeBootstrapConversationRouteRuntimePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/infra/bootstrap/runtime-bootstrap-conversation-route-runtime.ts',
);
const retiredRuntimeBootstrapHostCapabilitiesPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts',
);
const retiredRuntimeBootstrapHostCapabilitiesRoutingPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-routing.ts',
);
const tauriCommandsPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/commands/mod.rs',
);
const tauriModelIndexPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/model_index.rs',
);
const tauriLocalRuntimePackagePath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/mod.rs',
);

const installedSectionSource = readFileSync(installedSectionPath, 'utf-8');
const installedRowsSource = readFileSync(installedRowsPath, 'utf-8');
const installedSectionProjectionSource = `${installedSectionSource}\n${installedRowsSource}`;
const controllerSource = readFileSync(controllerPath, 'utf-8');
const localPageSource = readFileSync(localPagePath, 'utf-8');
const localModelCenterStateSource = readFileSync(localModelCenterStatePath, 'utf-8');
const localModelCenterUnregisteredAssetsSource = readFileSync(localModelCenterUnregisteredAssetsPath, 'utf-8');
const localModelCenterStateProjectionSource = `${localModelCenterStateSource}\n${localModelCenterUnregisteredAssetsSource}`;
const localModelCenterInstalledAssetsSource = readFileSync(localModelCenterInstalledAssetsPath, 'utf-8');
const localModelCenterImportActionsSource = readFileSync(localModelCenterImportActionsPath, 'utf-8');
const localModelCenterImportFilePlanSource = readFileSync(localModelCenterImportFilePlanPath, 'utf-8');
const localModelCenterUseHelpersSource = readFileSync(localModelCenterUseHelpersPath, 'utf-8');
const localModelCenterHelpersSource = readFileSync(localModelCenterHelpersPath, 'utf-8');
const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const localModelCenterUtilsSource = readFileSync(localModelCenterUtilsPath, 'utf-8');
const localModelCenterProgressCacheSource = readFileSync(localModelCenterProgressCachePath, 'utf-8');
const runtimeBootstrapRouteOptionsSource = readFileSync(runtimeBootstrapRouteOptionsPath, 'utf-8');
const runtimeConfigPanelEffectsSource = readFileSync(runtimeConfigPanelEffectsPath, 'utf-8');
const runtimeBootstrapConversationRouteRuntimeSource = readFileSync(runtimeBootstrapConversationRouteRuntimePath, 'utf-8');
const tauriCommandsSource = readFileSync(tauriCommandsPath, 'utf-8');
const tauriLocalRuntimePackageSource = readFileSync(tauriLocalRuntimePackagePath, 'utf-8');
const desktopReadmeSource = readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf-8');

test('local model center installed list is status-only and no longer renders a lifecycle toggle', () => {
  assert.doesNotMatch(installedSectionProjectionSource, /<Toggle/);
  assert.doesNotMatch(installedSectionProjectionSource, /onStartModel:/);
  assert.doesNotMatch(installedSectionProjectionSource, /onStopModel:/);
  assert.doesNotMatch(installedSectionProjectionSource, /localModelLifecycleById:/);
  assert.doesNotMatch(installedSectionProjectionSource, /filteredInstalledModels/);
  assert.match(installedSectionSource, /filteredInstalledRunnableAssets/);
  assert.match(installedSectionProjectionSource, /asset\.status === 'installed'/);
  assert.match(installedSectionProjectionSource, /runtimeConfig\.localModelCenter\.installed/);
});

test('desktop local page no longer wires start\\/stop\\/restart product actions into local model center', () => {
  assert.doesNotMatch(localPageSource, /onStart=\{model\.startLocalModel\}/);
  assert.doesNotMatch(localPageSource, /onStop=\{model\.stopLocalModel\}/);
  assert.doesNotMatch(localPageSource, /onRestart=\{model\.restartLocalModel\}/);
});

test('local model center hides removed tombstones from installed sections and reinstall indexes', () => {
  assert.match(localModelCenterInstalledAssetsSource, /const visibleInstalledAssets = useMemo\(/);
  assert.match(localModelCenterInstalledAssetsSource, /sortedInstalledAssets\.filter\(\(asset\) => asset\.status !== 'removed'\)/);
  assert.match(localModelCenterInstalledAssetsSource, /visibleInstalledAssets\.filter\(\(asset\) => isRunnableAssetKind\(asset\.kind\)\)/);
  assert.match(localModelCenterStateSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(localModelCenterStateSource, /new Map\(visibleInstalledAssets\.map\(\(asset\) => \[toCanonicalNimiRuntimeLocalAssetLookupKey\(asset\.assetId\), asset\] as const\)\)/);
  assert.doesNotMatch(localModelCenterStateSource, /@runtime\/local-runtime\/local-id/);
});

test('local model center consumes SDK local runtime asset-kind DX helpers', () => {
  assert.match(localModelCenterSectionsSource, /formatAssetKindLabel/);
  assert.match(localModelCenterUseHelpersSource, /NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS/);
  assert.match(localModelCenterUseHelpersSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(localModelCenterUseHelpersSource, /canImportNimiRuntimeLocalAssetDeclaration/);
  assert.match(localModelCenterUseHelpersSource, /normalizeNimiRuntimeLocalAssetDeclaration/);
  assert.match(localModelCenterUseHelpersSource, /normalizeNimiRuntimeLocalDependencyAssetDeclaration/);
  assert.match(localModelCenterUseHelpersSource, /nimiRuntimeLocalCapabilitiesForAssetKind/);
  assert.match(localModelCenterStateProjectionSource, /normalizeAssetDeclaration/);
  assert.doesNotMatch(localModelCenterUseHelpersSource, /ASSET_KIND_OPTIONS\.find/);
  assert.doesNotMatch(localModelCenterUseHelpersSource, /assetKind === 'auxiliary'/);
  assert.doesNotMatch(localModelCenterStateProjectionSource, /case 'controlnet'/);
});

test('local model center consumes SDK local recommendation DX helpers', () => {
  assert.match(localModelCenterHelpersSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(localModelCenterHelpersSource, /formatNimiRuntimeLocalRecommendationHostSupportLabel/);
  assert.match(localModelCenterHelpersSource, /formatNimiRuntimeLocalRecommendationConfidenceLabel/);
  assert.match(localModelCenterHelpersSource, /formatNimiRuntimeLocalRecommendationBaselineLabel/);
  assert.match(localModelCenterHelpersSource, /formatNimiRuntimeLocalRecommendationReasonLabel/);
  assert.match(localModelCenterHelpersSource, /summarizeNimiRuntimeLocalCatalogRecommendation/);
  assert.match(localModelCenterHelpersSource, /buildNimiRuntimeLocalRecommendationDetailItems/);
  assert.doesNotMatch(localModelCenterHelpersSource, /switch \(String\(code \|\| ''\)\.trim\(\)\)/);
  assert.doesNotMatch(localModelCenterHelpersSource, /case 'llmfit_vision_model'/);
  assert.doesNotMatch(localModelCenterHelpersSource, /function recommendationWorkloadLabel/);
});

test('dismissed transfer sessions persist across renderer reloads', () => {
  assert.match(localModelCenterProgressCacheSource, /DISMISSED_SESSION_STORAGE_KEY = 'nimi\.runtime\.local-model-center\.dismissed-transfer-sessions\.v1'/);
  assert.match(localModelCenterProgressCacheSource, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(localModelCenterProgressCacheSource, /readStorageJsonFrom\(resolveBrowserStorage\('local'\), DISMISSED_SESSION_STORAGE_KEY\)/);
  assert.match(localModelCenterProgressCacheSource, /writeStorageJsonTo\(resolveBrowserStorage\('local'\), DISMISSED_SESSION_STORAGE_KEY,/);
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

test('runtime config local snapshot polling does not duplicate runtime health truth', () => {
  assert.doesNotMatch(runtimeConfigPanelEffectsSource, /runtimeConfigLocalModelCenterClient\.health\(/);
  assert.match(runtimeConfigPanelEffectsSource, /useRuntimeHealthCoordinatorState/);
});

test('desktop route options do not fall back to global runtime endpoint fields', () => {
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /runtimeFields\.localProviderEndpoint/);
  assert.doesNotMatch(runtimeBootstrapRouteOptionsSource, /runtimeFields\.localOpenAiEndpoint/);
});

test('local route hydration prefers fresh local model adapter over stale binding adapter', () => {
  assert.equal(existsSync(retiredRuntimeBootstrapHostCapabilitiesRoutingPath), false);
  assert.match(runtimeBootstrapRouteOptionsSource, /listNimiRuntimeRouteOptionsWithHost\(\{/);
});

test('runtime route resolve uses the selected local binding and retired host-capability files stay absent', () => {
  assert.equal(existsSync(retiredRuntimeBootstrapHostCapabilitiesPath), false);
  assert.equal(existsSync(runtimeBootstrapRouteResolversPath), false);
  assert.match(runtimeBootstrapRouteOptionsSource, /runtimeLocalModels,/);
  assert.match(runtimeBootstrapConversationRouteRuntimeSource, /createNimiRuntimeRouteCapabilityRuntimeWithHost/);
  assert.doesNotMatch(runtimeBootstrapConversationRouteRuntimeSource, /resolveRuntimeRouteBindingFromSnapshot/);
  assert.doesNotMatch(runtimeBootstrapConversationRouteRuntimeSource, new RegExp(['createResolveRuntime', 'Binding'].join('')));
  assert.doesNotMatch(runtimeBootstrapConversationRouteRuntimeSource, new RegExp(retiredRouteResolverFileName.replace('.', '\\.')));
});

test('manual import no longer injects managed media loopback defaults and can forward explicit endpoints', () => {
  assert.doesNotMatch(localModelCenterImportActionsSource, /defaultImportEndpointForAssetDeclaration/);
  assert.match(localModelCenterImportActionsSource, /endpoint: String\(endpoint \|\| ''\)\.trim\(\) \|\| undefined/);
});

test('import dialog exposes attached endpoint input when runtime requires it', () => {
  assert.match(localModelCenterSectionsSource, /endpointRequired: boolean/);
  assert.match(localModelCenterSectionsSource, /onEndpointChange: \(endpoint: string\) => void/);
  assert.match(localModelCenterSectionsSource, /const showEndpointField = props\.endpointRequired/);
  assert.match(localModelCenterSectionsSource, /endpointRequiredPlaceholder/);
  assert.match(localModelCenterImportFilePlanSource, /const \[importEndpointRequired, setImportEndpointRequired\] = useState\(false\)/);
  assert.match(localModelCenterImportFilePlanSource, /const \[importCompatibilityHint, setImportCompatibilityHint\] = useState\(''\)/);
  assert.match(localModelCenterImportFilePlanSource, /const \[importPlanAvailable, setImportPlanAvailable\] = useState\(true\)/);
  assert.doesNotMatch(localModelCenterImportFilePlanSource, /runtimeConfigLocalModelCenterClient\.resolveInstallPlan\(/);
  assert.match(localModelCenterUtilsSource, /export function planRequiresAttachedEndpointInput\(/);
  assert.match(localModelCenterUtilsSource, /plan\.engineRuntimeMode === 'attached-endpoint'/);
  assert.match(localModelCenterUtilsSource, /export function planBlockingHint\(/);
  assert.match(localModelCenterUtilsSource, /export function basenameFromRuntimePath\(/);
  assert.match(localModelCenterUtilsSource, /export function planBlocksCanonicalImageImport\(/);
  assert.match(localModelCenterUtilsSource, /export function planCanonicalImageCompatibilityHint\(/);
  assert.match(localModelCenterImportFilePlanSource, /canChooseImportFile = useMemo\(/);
  assert.match(localModelCenterSectionsSource, /compatibilityHint\?: string/);
  assert.match(localModelCenterImportFilePlanSource, /setImportCompatibilityHint\(''\)/);
  assert.match(localModelCenterImportFilePlanSource, /setImportPlanAvailable\(true\)/);
  assert.match(localModelCenterStateSource, /useLocalModelCenterImportFilePlan\(/);
});

test('unregistered assets import flow also captures attached endpoints for media and speech', () => {
  assert.match(localModelCenterSectionsSource, /endpointByPath: Record<string, string>/);
  assert.match(localModelCenterSectionsSource, /compatibilityHintByPath: Record<string, string>/);
  assert.match(localModelCenterSectionsSource, /importAllowedByPath: Record<string, boolean>/);
  assert.match(localModelCenterSectionsSource, /onEndpointChange: \(path: string, endpoint: string\) => void/);
  assert.match(localModelCenterSectionsSource, /const showEndpointField = endpointRequired \|\| Boolean\(endpointValue\) \|\| Boolean\(endpointHint\)/);
  assert.match(localModelCenterStateProjectionSource, /const \[unregisteredEndpointByPath, setUnregisteredEndpointByPath\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(localModelCenterStateProjectionSource, /const \[unregisteredEndpointRequiredByPath, setUnregisteredEndpointRequiredByPath\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(localModelCenterStateProjectionSource, /const \[unregisteredCompatibilityHintByPath, setUnregisteredCompatibilityHintByPath\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(localModelCenterStateProjectionSource, /const \[unregisteredImportAllowedByPath, setUnregisteredImportAllowedByPath\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.doesNotMatch(localModelCenterStateProjectionSource, /runtimeConfigLocalModelCenterClient\.resolveInstallPlan\(/);
  assert.doesNotMatch(localModelCenterStateProjectionSource, /const previewFileName = basenameFromRuntimePath\(asset\.path\)/);
  assert.doesNotMatch(localModelCenterStateProjectionSource, /planCanonicalImageCompatibilityHint\(plan\)/);
  assert.match(localModelCenterStateSource, /importActions\.importAssetFromPath\(\s*assetPath,\s*declaration,\s*String\(unregisteredEndpointByPath\[assetPath\] \|\| ''\)\.trim\(\) \|\| undefined,\s*\)/s);
  assert.match(localModelCenterSectionsSource, /&& props\.importAllowedByPath\[asset\.path\] !== false/);
  assert.doesNotMatch(localModelCenterSectionsSource, /&& !compatibilityHint/);
});

test('scaffolded unregistered asset imports refresh installed asset sections immediately', () => {
  assert.match(localModelCenterImportActionsSource, /if \('scaffolded' in imported && imported\.scaffolded\) \{\s*await input\.props\.onDiscover\(\);\s*await input\.onRefreshAssetSections\(\);\s*await input\.onRefreshUnregisteredAssets\(\);\s*return;\s*\}/s);
});

test('installed attached-endpoint assets expose runtime reason-code repair flow instead of forcing remove and reimport', () => {
  assert.match(installedSectionProjectionSource, /function assetNeedsAttachedEndpointRepair\(/);
  assert.match(installedSectionProjectionSource, /asset\.reasonCode \|\| ''/);
  assert.doesNotMatch(installedSectionProjectionSource, /127\.0\.0\.1:8321|127\.0\.0\.1:8330|defaultManagedEndpointForEngine/);
  assert.match(installedSectionProjectionSource, /runtimeConfig\.localModelCenter\.repair/);
  assert.match(installedSectionProjectionSource, /props\.onRepairAsset\(props\.asset\.localAssetId, props\.repairEndpoint\)/);
  assert.match(localModelCenterStateSource, /const repairInstalledAsset = useCallback/);
  assert.match(localModelCenterStateSource, /Runtime manifest unavailable for asset repair/);
});

test('installed unhealthy assets surface runtime health detail in the model list', () => {
  assert.match(installedSectionProjectionSource, /props\.asset\.status === 'unhealthy' && String\(props\.asset\.healthDetail \|\| ''\)\.trim\(\)/);
  assert.match(installedSectionProjectionSource, /props\.asset\.status === 'unhealthy' && String\(props\.asset\.reasonCode \|\| ''\)\.trim\(\)/);
  assert.match(installedSectionProjectionSource, /text-\[var\(--nimi-status-danger\)\]/);
});

test('runtime local lifecycle controller remains available only as non-product maintenance surface', () => {
  assert.match(controllerSource, /from ['"]@nimiplatform\/sdk\/runtime['"]/);
  assert.doesNotMatch(controllerSource, /from ['"]@runtime\/local-runtime['"]/);
  assert.doesNotMatch(controllerSource, /from ['"]runtime\/internal/);
  assert.doesNotMatch(controllerSource, /from ['"]@renderer\/bridge\/runtime-bridge\/local-ai['"]/);
  assert.match(controllerSource, /runtimeConfigLocalModelCenterClient\.start\(localModelId, \{ caller: 'core' \}\)/);
  assert.match(controllerSource, /runtimeConfigLocalModelCenterClient\.stop\(localModelId, \{ caller: 'core' \}\)/);
  assert.match(controllerSource, /runtimeConfigLocalModelCenterClient\.remove\(localModelId, \{ caller: 'core' \}\)/);
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

test('desktop README does not document renderer-owned local provider route truth', () => {
  assert.doesNotMatch(desktopReadmeSource, /NIMI_PROVIDER/);
  assert.doesNotMatch(desktopReadmeSource, /NIMI_LOCAL_PROVIDER_ENDPOINT/);
  assert.doesNotMatch(desktopReadmeSource, /NIMI_LOCAL_PROVIDER_MODEL/);
  assert.doesNotMatch(desktopReadmeSource, /NIMI_LOCAL_OPENAI_ENDPOINT/);
  assert.doesNotMatch(desktopReadmeSource, /local:llama:openai_compat_adapter/);
  assert.doesNotMatch(desktopReadmeSource, /endpoint reachability alone is route truth/i);
  assert.match(desktopReadmeSource, /runtime authoritative local model list\/status/);
  assert.match(desktopReadmeSource, /endpoint reachability alone is not route truth/);
});

test('local model lifecycle writes route through SDK runtime service only', () => {
  assert.doesNotMatch(tauriCommandsSource, /runtime_local_assets_start/);
  assert.doesNotMatch(tauriCommandsSource, /runtime_local_assets_stop/);
  assert.doesNotMatch(tauriCommandsSource, /runtime_local_assets_health/);
  assert.doesNotMatch(tauriCommandsSource, /runtime_local_assets_remove/);
  assert.doesNotMatch(tauriCommandsSource, /start_asset\(&app, &payload\.local_asset_id\)/);
  assert.doesNotMatch(tauriCommandsSource, /stop_asset\(&app, &payload\.local_asset_id\)/);
  assert.doesNotMatch(tauriCommandsSource, /health_assets\(&app, local_asset_id\.as_deref\(\)\)/);
  assert.doesNotMatch(tauriCommandsSource, /load_state\(/);
  assert.doesNotMatch(tauriCommandsSource, /save_state\(/);
  assert.doesNotMatch(tauriCommandsSource, /append_audit_event/);
});

test('local runtime cleanup leaves only admitted picker and reveal helpers in Tauri', () => {
  assert.match(tauriCommandsSource, /pub fn runtime_local_pick_asset_manifest_path/);
  assert.match(tauriCommandsSource, /pub fn runtime_local_pick_asset_file/);
  assert.match(tauriCommandsSource, /pub fn runtime_local_pick_asset_directory/);
  assert.match(tauriCommandsSource, /pub fn runtime_local_assets_reveal_in_folder/);
  assert.match(tauriCommandsSource, /pub fn runtime_local_assets_reveal_root_folder/);
  assert.doesNotMatch(tauriCommandsSource, /RuntimeLocalService/);
  assert.doesNotMatch(tauriCommandsSource, /LocalAiAssetRecord/);
  assert.doesNotMatch(tauriCommandsSource, /runtime_managed_asset_dir/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod asset_registry;/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod supervisor;/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod model_index;/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod engine_host;/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod engine_pack;/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod import_validator;/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod service_lifecycle;/);
  assert.doesNotMatch(tauriLocalRuntimePackageSource, /mod store;/);
  assert.equal(existsSync(tauriModelIndexPath), false);
});
