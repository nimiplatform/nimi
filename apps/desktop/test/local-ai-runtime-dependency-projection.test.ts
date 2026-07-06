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
const reasonMessagesSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-reason-messages.ts',
);
const runtimeDependencyBannerSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-dependency-banner.tsx',
);
const runtimeDependencyStateSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-dependency-state.ts',
);
const installedSectionProjectionSource = `${installedSectionSource}\n${installedRowsSource}\n${runtimeDependencyBannerSource}\n${runtimeDependencyStateSource}`;
const runtimeViewSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-view.tsx',
);
const setupAutodiscoverSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-effect-setup-autodiscover.ts',
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
  assert.match(runtimeProjectionSources, /runtimeEnvironmentPlanByLocalAssetId/);
  assert.match(runtimeProjectionSources, /firstPlanWithBlockingDependency/);
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
  assert.match(runtimeProjectionSources, /runtimeDependencyByLocalAssetId/);
  assert.match(runtimeReadinessSource, /const assetDependency = firstBlockingDependency\(runtimeEnvironmentPlanByLocalAssetId\[asset\.localAssetId\]\)/);
  assert.doesNotMatch(runtimeProjectionSources, /runtimeEnvironmentPlanByAssetId/);
  assert.doesNotMatch(runtimeProjectionSources, /runtimeDependencyByAssetId/);
  assert.doesNotMatch(runtimeReadinessSource, /function firstImageAsset/);
  assert.doesNotMatch(runtimeReadinessSource, /next\[asset\.localAssetId\] = sharedRuntimeDependency/);
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
  assert.match(bridgeErrors, /RUNTIME_CALL_FAILED/);
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
  assert.match(installedSectionProjectionSource, /Enable local image generation/);
  assert.match(installedSectionProjectionSource, /Local image runtime setup failed/);
  assert.doesNotMatch(installedSectionProjectionSource, /Nimi needs one local CUDA runtime package before local models can use GPU acceleration/);
  assert.doesNotMatch(installedSectionProjectionSource, /sharedRuntimeDependencyDetail/);
  assert.doesNotMatch(installedSectionProjectionSource, /dependency\.message \|\| props\.sharedRuntimeDependency/);
  assert.doesNotMatch(installedSectionProjectionSource, /materializable_requires_confirmation/);
  // Regression: the machine reasonCode / state must never fall through into the
  // user-facing detail copy (it stays in the collapsed technical section only).
  assert.doesNotMatch(runtimeDependencyBannerSource, /dependency\?\.detail \|\| dependency\?\.reasonCode \|\| dependency\?\.state/);
  assert.doesNotMatch(installedRowsSource, /dependency\.detail \|\| dependency\.reasonCode \|\| dependency\.state/);
  assert.match(runtimeDependencyBannerSource, /runtimeConfig\.localModelCenter\.runtimeSetupRequiredDetail/);
  assert.match(runtimeDependencyBannerSource, /isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState/);
  // Regression: unhealthy asset rows must humanize the reason code (never render
  // the raw `reason=CODE` string); the raw code stays available on hover only.
  assert.doesNotMatch(installedRowsSource, /reason=\$\{/);
  assert.match(installedRowsSource, /localizedAssetUnhealthyReason/);
  assert.match(installedRowsSource, /runtimeConfig\.localModelCenter\.assetUnhealthyGeneric/);
  // The localized resolver keys off the canonical reason code and falls back to
  // the SDK English default, never the raw machine code.
  assert.match(reasonMessagesSource, /normalizeNimiRuntimeReasonCode/);
  assert.match(reasonMessagesSource, /assetUnhealthyReasonSummary/);
  assert.match(reasonMessagesSource, /runtimeConfig\.reasonMessages\.\$\{normalized\}/);
  assert.doesNotMatch(
    installedSectionProjectionSource,
    /props\.onSetupRuntimeDependency\(asset\.localAssetId\)/,
  );
  assert.match(installedRowsSource, /job\.consumerScope === dependency\.consumerScope/);
  assert.match(runtimeReadinessSource, /job\.consumerScope === dependency\.consumerScope/);
});

test('local image installed rows project runtime readiness instead of installed asset status', () => {
  assert.match(installedRowsSource, /function runtimeDependencyReadinessLabel/);
  assert.match(installedRowsSource, /Setup needed/);
  assert.match(installedRowsSource, /runtimeDependencyShortStatusLabel/);
  assert.match(installedRowsSource, /Runtime setup failed/);
  assert.match(installedRowsSource, /const statusLabel = hasRuntimeDependencyWarning[\s\S]{0,160}runtimeDependencyReadinessLabel/);
  assert.match(installedRowsSource, /hasRuntimeDependencyWarning[\s\S]{0,160}assetStatusBadgeClass/);
  assert.match(installedRowsSource, /props\.canStartRuntimeDependencySetup/);
  assert.match(installedRowsSource, /runtimeConfig\.localModelCenter\.setupDependency/);
  assert.match(installedSectionSource, /const canStartAssetRuntimeDependencySetup = runtimeDependencySetupAllowed\(runtimeDependency, runtimeDependencyJob\)/);
  assert.match(installedSectionSource, /canStartRuntimeDependencySetup=\{canStartAssetRuntimeDependencySetup\}/);
  assert.match(installedSectionSource, /onSetupRuntimeDependency=\{props\.onSetupRuntimeDependency\}/);
});

test('local image runtime readiness excludes companion-only image artifacts', () => {
  assert.match(runtimeReadinessSource, /function isImageRuntimeMainAsset/);
  assert.match(runtimeReadinessSource, /asset\.artifactRoles/);
  assert.match(runtimeReadinessSource, /uncond_diffusion_model/);
  assert.match(runtimeReadinessSource, /return assets\.filter\(isImageRuntimeMainAsset\)/);
  assert.match(runtimeReadinessSource, /if \(!isImageRuntimeMainAsset\(asset\)\)/);
  assert.doesNotMatch(runtimeReadinessSource, /assets\.filter\(\(asset\) => asset\.kind === 'image'\)/);
});

test('local image runtime readiness ignores stale ready jobs when current dependency blocks activation', () => {
  assert.match(installedSectionProjectionSource, /runtimeDependencyJobShouldSurface/);
  assert.match(installedSectionProjectionSource, /runtimeDependencyCurrentState/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyJobActiveState/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyJobRetryableState/);
  assert.match(installedSectionProjectionSource, /isNimiRuntimeLocalEnvironmentDependencyReadyState/);
  assert.match(installedRowsSource, /runtimeDependencyJobShouldSurface\(dependency, job\)/);
  assert.match(runtimeDependencyBannerSource, /const displayJob = runtimeDependencyJobForDisplay\(props\.dependency, props\.job\)/);
  assert.doesNotMatch(installedSectionProjectionSource, /job\?\.state \|\| dependency\?\.state/);
});

test('local image runtime setup surfaces job phase progress and stale evidence', () => {
  assert.match(runtimeDependencyBannerSource, /runtimeDependencyStateStageLabel/);
  assert.match(runtimeDependencyBannerSource, /Downloading local image runtime package/);
  assert.match(runtimeDependencyBannerSource, /Installing local image runtime\. This step can take several minutes/);
  assert.match(runtimeDependencyBannerSource, /runtimeDependencyProgressSummary/);
  assert.match(runtimeDependencyBannerSource, /job\.bytesReceived/);
  assert.match(runtimeDependencyBannerSource, /job\.bytesTotal/);
  assert.match(runtimeDependencyBannerSource, /job\.speedBytesPerSec/);
  assert.match(runtimeDependencyBannerSource, /job\.etaSeconds/);
  assert.match(runtimeDependencyBannerSource, /runtimeDependencyJobIsStale/);
  assert.match(runtimeDependencyBannerSource, /No progress has been reported for more than 5 minutes/);
  assert.match(runtimeDependencyBannerSource, /Runtime details/);
  assert.doesNotMatch(runtimeDependencyBannerSource, /Runtime job: \{\{state\}\}/);
});

test('local model center projects Runtime-owned local environment state instead of desktop file fallback', () => {
  assert.match(runtimeProjectionSources, /runtimeConfigLocalModelCenterClient\.resolveEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeEnvironmentPlan/);
  assert.match(runtimeViewSource, /LocalModelCenterInstalledAssetsSection/);
  assert.doesNotMatch(runtimeProjectionSources, /readTextFile|fs\.|state\.json/);
});

test('runtime setup autodiscovery is debounced across panel remounts', () => {
  assert.match(setupAutodiscoverSource, /let runtimeConfigSetupAutodiscoverTriggered = false/);
  assert.match(setupAutodiscoverSource, /if \(runtimeConfigSetupAutodiscoverTriggered\) return/);
  assert.match(setupAutodiscoverSource, /runtimeConfigSetupAutodiscoverTriggered = true;\s*void input\.discoverLocalModels\(\{ visible: false \}\)/);
  assert.doesNotMatch(setupAutodiscoverSource, /useRef/);
});

test('local runtime facade exposes SDK-backed local environment projection methods', () => {
  assert.equal(fs.existsSync(path.join(import.meta.dirname, '..', 'src/runtime/local-runtime/index.ts')), false);
  assert.doesNotMatch(runtimeProjectionSources, /@runtime\/local-runtime/);
  assert.match(runtimeProjectionSources, /from '@nimiplatform\/sdk\/runtime'/);
});
