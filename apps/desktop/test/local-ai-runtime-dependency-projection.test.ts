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
const runtimeViewSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-view.tsx',
);
const localRuntimeFacadeSource = readWorkspaceFile(
  'src/runtime/local-runtime/index.ts',
);
const sdkLocalRuntimeFacadeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../sdk/src/runtime/local-runtime-client/index.ts'),
  'utf8',
);
const localRuntimeCommandsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../sdk/src/runtime/local-runtime-client/commands-assets.ts'),
  'utf8',
);
const localRuntimeParsersSource = fs.readFileSync(
  path.join(import.meta.dirname, '../../../sdk/src/runtime/local-runtime-client/parsers-runtime-events.ts'),
  'utf8',
);

test('local model center resolves shared runtime dependency readiness before any imported model is required', () => {
  assert.match(runtimeProjectionSources, /localRuntime\.resolveEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /packId:\s*'local-gpu-support'/);
  assert.match(runtimeProjectionSources, /packId:\s*'local-image-native'/);
  assert.match(runtimeProjectionSources, /consumerScope:\s*'desktop\.local-model-center'/);
  assert.match(runtimeProjectionSources, /sharedRuntimeEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeDependency/);
  assert.match(runtimeProjectionSources, /sharedRuntimeDependencyJobs/);
  assert.match(runtimeProjectionSources, /setupRuntimeDependency/);
  assert.match(runtimeProjectionSources, /localRuntime\.startEnvironmentDependencyJob/);
  assert.match(runtimeReadinessSource, /isLocalRuntimeEnvironmentDependencyReadyState/);
  assert.match(runtimeReadinessSource, /isLocalRuntimeEnvironmentDependencyStartableState/);
  assert.match(runtimeReadinessSource, /isLocalRuntimeEnvironmentDependencyJobActiveState/);
  assert.doesNotMatch(runtimeReadinessSource, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(runtimeReadinessSource, /STARTABLE_RUNTIME_DEPENDENCY_STATES/);
  assert.doesNotMatch(runtimeReadinessSource, /localRuntime\.startDependencySetup/);
  assert.doesNotMatch(runtimeReadinessSource, /localRuntime\.resolveDependency/);
  assert.match(runtimeReadinessSource, /imageConsumerScopeForDevice/);
  assert.match(runtimeReadinessSource, /localAssetId:\s*asset\.localAssetId/);
  assert.match(runtimeReadinessSource, /prepareAssetRuntimeDependencies/);
  assert.match(runtimeProjectionSources, /runtimeDependencyByAssetId/);
});

test('local model center setup CTA projects shared dependency resolver truth at page level', () => {
  assert.match(installedSectionSource, /sharedRuntimeDependencyNeedsSetup/);
  assert.match(installedSectionSource, /props\.sharedRuntimeDependency/);
  assert.match(installedSectionSource, /props\.onSetupRuntimeDependency\(\)/);
  assert.match(installedSectionSource, /props\.onCancelRuntimeDependencyJob/);
  assert.match(installedSectionSource, /props\.onRetryRuntimeDependencyJob/);
  assert.match(installedSectionSource, /props\.onRepairRuntimeDependency/);
  assert.match(installedSectionSource, /isLocalRuntimeEnvironmentDependencyJobActiveState/);
  assert.match(installedSectionSource, /isLocalRuntimeEnvironmentDependencyJobRetryableState/);
  assert.doesNotMatch(installedSectionSource, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(installedSectionSource, /RETRYABLE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.match(installedSectionSource, /dependency\?\.state === 'needs_confirmation'/);
  assert.match(installedSectionSource, /dependency\.confirmationRequired === true/);
  assert.match(installedSectionSource, /cudaModelWaitingForSetup/);
  assert.match(installedSectionSource, /Local image runtime setup/);
  assert.doesNotMatch(installedSectionSource, /Nimi needs one local CUDA runtime package before local models can use GPU acceleration/);
  assert.doesNotMatch(installedSectionSource, /sharedRuntimeDependencyDetail/);
  assert.doesNotMatch(installedSectionSource, /dependency\.message \|\| props\.sharedRuntimeDependency/);
  assert.doesNotMatch(installedSectionSource, /materializable_requires_confirmation/);
  assert.doesNotMatch(
    installedSectionSource,
    /props\.onSetupRuntimeDependency\(asset\.localAssetId\)/,
  );
});

test('local model center projects Runtime-owned local environment state instead of desktop file fallback', () => {
  assert.match(runtimeProjectionSources, /localRuntime\.resolveEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeEnvironmentPlan/);
  assert.match(runtimeViewSource, /LocalModelCenterInstalledAssetsSection/);
  assert.doesNotMatch(runtimeProjectionSources, /readTextFile|fs\.|state\.json/);
});

test('local runtime facade exposes SDK-backed local environment projection methods', () => {
  assert.match(localRuntimeFacadeSource, /\.\.\.sdkLocalRuntime/);
  assert.match(sdkLocalRuntimeFacadeSource, /resolveEnvironmentPlan:\s*resolveLocalRuntimeEnvironmentPlan/);
  assert.match(sdkLocalRuntimeFacadeSource, /listEnvironmentDependencyJobs:\s*listLocalRuntimeEnvironmentDependencyJobs/);
  assert.match(sdkLocalRuntimeFacadeSource, /startEnvironmentDependencyJob:\s*startLocalRuntimeEnvironmentDependencyJob/);
  assert.match(sdkLocalRuntimeFacadeSource, /cancelEnvironmentDependencyJob:\s*cancelLocalRuntimeEnvironmentDependencyJob/);
  assert.match(sdkLocalRuntimeFacadeSource, /retryEnvironmentDependencyJob:\s*retryLocalRuntimeEnvironmentDependencyJob/);
  assert.match(sdkLocalRuntimeFacadeSource, /repairEnvironmentDependency:\s*repairLocalRuntimeEnvironmentDependency/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /listEnvironmentSelectedSources/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /resolveEnvironmentActivationGate/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /startDependencySetup/);
  assert.match(localRuntimeCommandsSource, /runtime\.resolveLocalEnvironmentPlan/);
  assert.match(localRuntimeCommandsSource, /assetId:\s*String\(payload\.assetId \|\| ''\)\.trim\(\)/);
  assert.match(localRuntimeCommandsSource, /localAssetId:\s*String\(payload\.localAssetId \|\| ''\)\.trim\(\)/);
  assert.match(localRuntimeCommandsSource, /companionAssetId:\s*String\(payload\.companionAssetId \|\| ''\)\.trim\(\)/);
  assert.match(localRuntimeCommandsSource, /parentAssetId:\s*String\(payload\.parentAssetId \|\| ''\)\.trim\(\)/);
  assert.match(localRuntimeCommandsSource, /runtime\.listLocalEnvironmentDependencyJobs/);
  assert.doesNotMatch(localRuntimeCommandsSource, /runtime\.listLocalEnvironmentSelectedSources/);
  assert.doesNotMatch(localRuntimeCommandsSource, /runtime\.resolveLocalEnvironmentActivationGate/);
  assert.match(localRuntimeCommandsSource, /runtime\.startLocalEnvironmentDependencyJob/);
  assert.match(localRuntimeCommandsSource, /runtime\.cancelLocalEnvironmentDependencyJob/);
  assert.match(localRuntimeCommandsSource, /runtime\.retryLocalEnvironmentDependencyJob/);
  assert.match(localRuntimeCommandsSource, /runtime\.repairLocalEnvironmentDependency/);
  assert.doesNotMatch(localRuntimeCommandsSource, /runtime\.startLocalRuntimeDependencySetup/);
});

test('local runtime dependency plan and job parsers delegate projection ownership to SDK', () => {
  assert.match(localRuntimeParsersSource, /parseLocalRuntimeEnvironmentPlanProjection/);
  assert.match(localRuntimeParsersSource, /parseLocalRuntimeEnvironmentDependencyJobProjection/);
  assert.match(localRuntimeParsersSource, /parseLocalRuntimeEnvironmentPlanProjection as parseLocalRuntimeEnvironmentPlan/);
  assert.doesNotMatch(localRuntimeParsersSource, /function parseLocalRuntimeEnvironmentPlan\(/);
  assert.doesNotMatch(localRuntimeParsersSource, /function parseLocalRuntimeEnvironmentDependencyJob\(/);
  assert.doesNotMatch(localRuntimeParsersSource, /function clampPercent\(/);
});

test('local runtime facade does not expose unmounted local service lifecycle controls', () => {
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /\blistServices:/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /\binstallService:/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /\bstartService:/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /\bstopService:/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /\bhealthServices:/);
  assert.doesNotMatch(sdkLocalRuntimeFacadeSource, /\bremoveService:/);
  assert.match(sdkLocalRuntimeFacadeSource, /listNodesCatalog:\s*listLocalRuntimeNodesCatalog/);
});
