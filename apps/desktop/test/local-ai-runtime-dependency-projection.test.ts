import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const runtimeStateSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.ts',
);
const runtimeReadinessSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-readiness.ts',
);
const runtimeProjectionSources = `${runtimeStateSource}\n${runtimeReadinessSource}`;
const installedSectionSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-section.tsx',
);
const installedRowsSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-rows.tsx',
);
const runtimeDependencyBannerSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-dependency-banner.tsx',
);
const installedSectionProjectionSource = `${installedSectionSource}\n${installedRowsSource}\n${runtimeDependencyBannerSource}`;
const runtimeViewSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-view.tsx',
);
const bridgeErrorsEnSource = readWorkspaceFile(
  'src/shell/renderer/locales/en/53-BridgeErrors.json',
);
const bridgeErrorsZhSource = readWorkspaceFile(
  'src/shell/renderer/locales/zh/53-BridgeErrors.json',
);

test('local model center resolves shared runtime dependency readiness before any imported model is required', () => {
  assert.match(runtimeProjectionSources, /runtimeConfigLocalModelCenterClient\.resolveEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /packId:\s*'local-gpu-support'/);
  assert.match(runtimeProjectionSources, /consumerScope:\s*'desktop\.local-model-center'/);
  assert.match(runtimeProjectionSources, /resolveNimiRuntimeLocalImageNativeEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeDependency/);
  assert.match(runtimeProjectionSources, /sharedRuntimeDependencyJobs/);
  assert.match(runtimeProjectionSources, /setupRuntimeDependency/);
  assert.match(runtimeProjectionSources, /runtimeConfigLocalModelCenterClient\.startEnvironmentDependencyJob/);
  assert.equal((runtimeReadinessSource.match(/consumerScope:\s*dependency\.consumerScope/g) || []).length, 2);
  assert.match(runtimeReadinessSource, /consumerScope:\s*sharedRuntimeDependency\.consumerScope/);
  assert.match(runtimeReadinessSource, /isNimiRuntimeLocalEnvironmentDependencyReadyState/);
  assert.match(runtimeReadinessSource, /isNimiRuntimeLocalEnvironmentDependencyStartableState/);
  assert.match(runtimeReadinessSource, /isNimiRuntimeLocalEnvironmentDependencyJobActiveState/);
  assert.doesNotMatch(runtimeReadinessSource, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(runtimeReadinessSource, /STARTABLE_RUNTIME_DEPENDENCY_STATES/);
  assert.doesNotMatch(runtimeReadinessSource, /runtimeConfigLocalModelCenterClient\.startDependencySetup/);
  assert.doesNotMatch(runtimeReadinessSource, /runtimeConfigLocalModelCenterClient\.resolveDependency/);
  assert.doesNotMatch(runtimeReadinessSource, /stable-diffusion\.cpp/);
  assert.match(runtimeReadinessSource, /asset,\s*\}/);
  assert.match(runtimeReadinessSource, /prepareAssetRuntimeDependencies/);
  const prepareBody = runtimeReadinessSource.slice(
    runtimeReadinessSource.indexOf('const prepareAssetRuntimeDependencies'),
    runtimeReadinessSource.indexOf('const cancelRuntimeDependencyJob'),
  );
  assert.match(prepareBody, /!dependency\.confirmationRequired/);
  assert.match(prepareBody, /confirmed:\s*false/);
  assert.doesNotMatch(prepareBody, /confirmed:\s*true/);
  assert.match(runtimeProjectionSources, /runtimeDependencyByAssetId/);
});

test('local model center surfaces runtime inventory failures instead of replacing them with empty success', () => {
  assert.match(runtimeProjectionSources, /runtimeInventoryError/);
  assert.match(runtimeProjectionSources, /runtimeDependencyError/);
  assert.match(runtimeViewSource, /props\.runtimeInventoryError \|\| props\.runtimeDependencyError/);
  assert.doesNotMatch(runtimeStateSource, /catch\s*\{[\s\S]{0,180}setCatalogItems\(\[\]\)/);
  assert.doesNotMatch(runtimeStateSource, /catch\s*\{[\s\S]{0,180}setVerifiedModels\(\[\]\)/);
  assert.doesNotMatch(runtimeStateSource, /catch\s*\{[\s\S]{0,180}setInstalledAssets\(\[\]\)/);
  assert.doesNotMatch(runtimeStateSource, /catch\s*\{[\s\S]{0,180}setVerifiedAssets\(\[\]\)/);
  assert.doesNotMatch(runtimeReadinessSource, /catch\s*\([^)]*\)\s*\{[\s\S]{0,180}setSharedRuntimeEnvironmentPlan\(undefined\)/);
  assert.doesNotMatch(runtimeReadinessSource, /catch\s*\([^)]*\)\s*\{[\s\S]{0,180}setSharedRuntimeDependencyJobs\(\[\]\)/);
});

test('BridgeErrors projects Local Speech failure families without Qwen-specific owner copy', () => {
  const bridgeErrors = `${bridgeErrorsEnSource}\n${bridgeErrorsZhSource}`;
  assert.match(bridgeErrors, /LOCAL_AI_SPEECH_GPU_REQUIRED/);
  assert.match(bridgeErrors, /LOCAL_AI_SPEECH_BOOTSTRAP_FAILED/);
  assert.doesNotMatch(bridgeErrors, /LOCAL_AI_QWEN|Qwen TTS/);
});

test('local model center setup CTA projects shared dependency resolver truth at page level', () => {
  assert.match(installedSectionSource, /sharedRuntimeDependencyRequiresAttention/);
  assert.match(installedSectionSource, /props\.sharedRuntimeDependency/);
  assert.match(installedSectionSource, /props\.onSetupRuntimeDependency\(\)/);
  assert.match(installedSectionSource, /props\.onCancelRuntimeDependencyJob/);
  assert.match(installedSectionSource, /props\.onRetryRuntimeDependencyJob/);
  assert.match(installedSectionSource, /props\.onRepairRuntimeDependency/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyJobActiveState/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyJobRetryableState/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyReadyState/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyJobFailedState/);
  assert.match(installedSectionProjectionSource, /runtimeDependencyBannerTitle/);
  assert.match(installedSectionProjectionSource, /runtimeDependencyStatusDetail/);
  assert.doesNotMatch(installedSectionProjectionSource, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(installedSectionProjectionSource, /RETRYABLE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(installedSectionProjectionSource, /dependency\?\.state === 'needs_confirmation'/);
  assert.match(installedSectionProjectionSource, /dependency\.confirmationRequired/);
  assert.doesNotMatch(installedSectionProjectionSource, /cudaModelWaitingForSetup/);
  assert.match(installedSectionProjectionSource, /Local image runtime setup/);
  assert.match(installedSectionProjectionSource, /Local image runtime setup failed/);
  assert.doesNotMatch(installedSectionProjectionSource, /Nimi needs one local CUDA runtime package before local models can use GPU acceleration/);
  assert.doesNotMatch(installedSectionProjectionSource, /sharedRuntimeDependencyDetail/);
  assert.doesNotMatch(installedSectionProjectionSource, /dependency\.message \|\| props\.sharedRuntimeDependency/);
  assert.doesNotMatch(installedSectionProjectionSource, /materializable_requires_confirmation/);
  assert.doesNotMatch(
    installedSectionProjectionSource,
    /props\.onSetupRuntimeDependency\(asset\.localAssetId\)/,
  );
});

test('local model center projects Runtime-owned local environment state instead of desktop file fallback', () => {
  assert.match(runtimeProjectionSources, /runtimeConfigLocalModelCenterClient\.resolveEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeEnvironmentPlan/);
  assert.match(runtimeViewSource, /LocalModelCenterInstalledAssetsSection/);
  assert.doesNotMatch(runtimeProjectionSources, /readTextFile|fs\.|state\.json/);
});

test('local runtime facade exposes SDK-backed local environment projection methods', () => {
  assert.equal(fs.existsSync(path.join(import.meta.dirname, '..', 'src/runtime/local-runtime/index.ts')), false);
  assert.doesNotMatch(runtimeProjectionSources, /@runtime\/local-runtime/);
  assert.match(runtimeProjectionSources, /from '@nimiplatform\/sdk\/runtime'/);
});
