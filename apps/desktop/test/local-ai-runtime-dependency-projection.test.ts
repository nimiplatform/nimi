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
const localRuntimeCommandsSource = readWorkspaceFile(
  'src/runtime/local-runtime/commands-assets.ts',
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
  assert.match(localRuntimeFacadeSource, /resolveEnvironmentPlan:\s*resolveLocalRuntimeEnvironmentPlan/);
  assert.match(localRuntimeFacadeSource, /listEnvironmentDependencyJobs:\s*listLocalRuntimeEnvironmentDependencyJobs/);
  assert.match(localRuntimeFacadeSource, /startEnvironmentDependencyJob:\s*startLocalRuntimeEnvironmentDependencyJob/);
  assert.match(localRuntimeFacadeSource, /cancelEnvironmentDependencyJob:\s*cancelLocalRuntimeEnvironmentDependencyJob/);
  assert.match(localRuntimeFacadeSource, /retryEnvironmentDependencyJob:\s*retryLocalRuntimeEnvironmentDependencyJob/);
  assert.match(localRuntimeFacadeSource, /repairEnvironmentDependency:\s*repairLocalRuntimeEnvironmentDependency/);
  assert.doesNotMatch(localRuntimeFacadeSource, /listEnvironmentSelectedSources/);
  assert.doesNotMatch(localRuntimeFacadeSource, /resolveEnvironmentActivationGate/);
  assert.doesNotMatch(localRuntimeFacadeSource, /startDependencySetup/);
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

test('local runtime facade does not expose unmounted local service lifecycle controls', () => {
  assert.doesNotMatch(localRuntimeFacadeSource, /\blistServices:/);
  assert.doesNotMatch(localRuntimeFacadeSource, /\binstallService:/);
  assert.doesNotMatch(localRuntimeFacadeSource, /\bstartService:/);
  assert.doesNotMatch(localRuntimeFacadeSource, /\bstopService:/);
  assert.doesNotMatch(localRuntimeFacadeSource, /\bhealthServices:/);
  assert.doesNotMatch(localRuntimeFacadeSource, /\bremoveService:/);
  assert.match(localRuntimeFacadeSource, /listNodesCatalog:\s*listLocalRuntimeNodesCatalog/);
});
