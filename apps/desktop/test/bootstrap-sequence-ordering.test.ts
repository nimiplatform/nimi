import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BOOTSTRAP_PATH = resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts');
const bootstrapSource = readFileSync(BOOTSTRAP_PATH, 'utf-8');
const PLATFORM_CLIENT_INIT = 'createLocalFirstPartyRuntimePlatformClient(';

describe('bootstrap sequence ordering (D-BOOT)', () => {
  test('D-BOOT-001: bootstrap loads runtime defaults before platform client init', () => {
    const defaultsIndex = bootstrapSource.indexOf('getRuntimeDefaults()');
    const platformClientIndex = bootstrapSource.indexOf(PLATFORM_CLIENT_INIT);
    assert.ok(defaultsIndex !== -1, 'getRuntimeDefaults() must appear in bootstrap source');
    assert.ok(platformClientIndex !== -1, `${PLATFORM_CLIENT_INIT} must appear in bootstrap source`);
    assert.ok(
      defaultsIndex < platformClientIndex,
      `getRuntimeDefaults() (pos ${defaultsIndex}) must appear before ${PLATFORM_CLIENT_INIT} (pos ${platformClientIndex})`,
    );
  });

  test('D-BOOT-002: platform client init precedes DataSync init', () => {
    const platformClientIndex = bootstrapSource.indexOf(PLATFORM_CLIENT_INIT);
    const dataSyncIndex = bootstrapSource.indexOf('dataSync.initApi(');
    assert.ok(platformClientIndex !== -1, `${PLATFORM_CLIENT_INIT} must appear in bootstrap source`);
    assert.ok(dataSyncIndex !== -1, 'dataSync.initApi( must appear in bootstrap source');
    assert.ok(
      platformClientIndex < dataSyncIndex,
      `${PLATFORM_CLIENT_INIT} (pos ${platformClientIndex}) must appear before dataSync.initApi( (pos ${dataSyncIndex})`,
    );
  });

  test('D-BOOT-003: world evolution selector-read provider attaches after platform client init and before DataSync init', () => {
    const platformClientIndex = bootstrapSource.indexOf(PLATFORM_CLIENT_INIT);
    const attachIndex = bootstrapSource.indexOf('unstable_attachPlatformWorldEvolutionSelectorReadProvider(');
    const dataSyncIndex = bootstrapSource.indexOf('dataSync.initApi(');
    assert.ok(platformClientIndex !== -1, `${PLATFORM_CLIENT_INIT} must appear in bootstrap source`);
    assert.ok(attachIndex !== -1, 'unstable_attachPlatformWorldEvolutionSelectorReadProvider( must appear in bootstrap source');
    assert.ok(dataSyncIndex !== -1, 'dataSync.initApi( must appear in bootstrap source');
    assert.ok(
      platformClientIndex < attachIndex,
      `${PLATFORM_CLIENT_INIT} (pos ${platformClientIndex}) must appear before unstable_attachPlatformWorldEvolutionSelectorReadProvider( (pos ${attachIndex})`,
    );
    assert.ok(
      attachIndex < dataSyncIndex,
      `unstable_attachPlatformWorldEvolutionSelectorReadProvider( (pos ${attachIndex}) must appear before dataSync.initApi( (pos ${dataSyncIndex})`,
    );
  });

  test('D-BOOT-004: runtime host assembly gated by enableRuntimeBootstrap flag', () => {
    assert.ok(
      bootstrapSource.includes('flags.enableRuntimeBootstrap'),
      'bootstrap must gate runtime host assembly behind flags.enableRuntimeBootstrap',
    );
  });

  test('D-BOOT-005: runtime host assembly precedes post-ready runtime mod hydration eligibility', () => {
    const hostCapabilitiesIndex = bootstrapSource.indexOf('buildRuntimeHostCapabilities(');
    const hydrationEligibleIndex = bootstrapSource.indexOf('shouldSchedulePostReadyRuntimeModHydration = true;');
    assert.ok(hostCapabilitiesIndex !== -1, 'buildRuntimeHostCapabilities( must appear in bootstrap source');
    assert.ok(hydrationEligibleIndex !== -1, 'post-ready runtime mod hydration eligibility must appear in bootstrap source');
    assert.ok(
      hostCapabilitiesIndex < hydrationEligibleIndex,
      `buildRuntimeHostCapabilities( (pos ${hostCapabilitiesIndex}) must appear before post-ready hydration eligibility (pos ${hydrationEligibleIndex})`,
    );
  });

  test('D-BOOT-005: post-ready runtime mod hydration is scheduled after bootstrapReady', () => {
    const readyIndex = bootstrapSource.indexOf('useAppStore.getState().setBootstrapReady(true);');
    const scheduleIndex = bootstrapSource.indexOf('schedulePostReadyRuntimeModHydration({ flowId });');
    const registerIndex = bootstrapSource.indexOf('registerBootstrapRuntimeMods({');
    const hydratingProjectionIndex = bootstrapSource.indexOf("status: 'hydrating'");
    assert.ok(readyIndex !== -1, 'setBootstrapReady(true); must appear in bootstrap source');
    assert.ok(scheduleIndex !== -1, 'schedulePostReadyRuntimeModHydration({ flowId }); must appear in bootstrap source');
    assert.ok(registerIndex !== -1, 'registerBootstrapRuntimeMods({ must appear in bootstrap source');
    assert.ok(hydratingProjectionIndex !== -1, 'post-ready runtime mod hydration must project hydrating state');
    assert.ok(
      readyIndex < scheduleIndex,
      'post-ready runtime mod hydration must be scheduled only after bootstrapReady is set',
    );
    assert.doesNotMatch(
      bootstrapSource,
      /await withBootstrapStepTimeout\(\s*['"]runtime mod bootstrap registration['"]/,
      'runtime mod registration must not be awaited in the bootstrap critical path',
    );
  });

  test('D-BOOT-006: external agent bridge bootstrap is scheduled after runtime host readiness', () => {
    const hydrationEligibleIndex = bootstrapSource.indexOf('shouldSchedulePostReadyRuntimeModHydration = true;');
    const tier1ActionsIndex = bootstrapSource.indexOf('registerExternalAgentTier1Actions(hookRuntime);');
    const bridgeStartIndex = bootstrapSource.indexOf("step: 'external agent action bridge startup'");
    const descriptorSyncIndex = bootstrapSource.indexOf("step: 'external agent descriptor resync'");
    assert.ok(hydrationEligibleIndex !== -1, 'post-ready runtime mod hydration eligibility must appear in bootstrap source');
    assert.ok(tier1ActionsIndex !== -1, 'registerExternalAgentTier1Actions(hookRuntime); must appear in bootstrap source');
    assert.ok(bridgeStartIndex !== -1, 'external agent bridge startup must be scheduled in bootstrap source');
    assert.ok(descriptorSyncIndex !== -1, 'external agent descriptor resync must be scheduled in bootstrap source');
    assert.ok(hydrationEligibleIndex < tier1ActionsIndex, 'external agent tier-1 action registration must happen after runtime host readiness is established');
    assert.ok(tier1ActionsIndex < bridgeStartIndex, 'action bridge scheduling must happen after tier-1 action registration');
    assert.ok(bridgeStartIndex < descriptorSyncIndex, 'descriptor resync scheduling must happen after bridge startup scheduling');
  });

  test('D-BOOT-007: auth bootstrap completes before runtime host work that can issue scheduling probes', () => {
    const authSessionIndex = bootstrapSource.indexOf('getAccountSessionStatus({');
    const hydrationEligibleIndex = bootstrapSource.indexOf('shouldSchedulePostReadyRuntimeModHydration = true;');
    const bootstrapReadyIndex = bootstrapSource.indexOf('useAppStore.getState().setBootstrapReady(true);');
    assert.ok(authSessionIndex !== -1, 'Runtime account status bootstrap must appear in bootstrap source');
    assert.ok(hydrationEligibleIndex !== -1, 'post-ready runtime mod hydration eligibility must appear in bootstrap source');
    assert.ok(bootstrapReadyIndex !== -1, 'setBootstrapReady(true); must appear in bootstrap source');
    assert.ok(authSessionIndex < hydrationEligibleIndex, 'Runtime account status bootstrap must run before runtime host work can schedule mod hydration');
    assert.ok(authSessionIndex < bootstrapReadyIndex, 'Runtime account status bootstrap must complete before bootstrapReady is set');
  });

  test('D-BOOT-008: bootstrap failure sets bootstrapError and clears auth', () => {
    const catchIndex = bootstrapSource.indexOf('.catch(async (error)');
    assert.ok(catchIndex !== -1, '.catch(async (error) block must exist in bootstrap source');
    const catchBlock = bootstrapSource.slice(catchIndex);
    assert.ok(
      catchBlock.includes('setBootstrapError'),
      'catch block must call setBootstrapError',
    );
    assert.ok(
      catchBlock.includes('clearAuthSession'),
      'catch block must call clearAuthSession',
    );
  });

  test('D-BOOT-009: repeated bootstrap calls return same promise (idempotency)', () => {
    assert.ok(
      bootstrapSource.includes('if (bootstrapPromise)'),
      'bootstrap must guard against repeated calls with if (bootstrapPromise)',
    );
  });

  test('D-BOOT-012: realm unavailability does not block bootstrap', () => {
    // Bootstrap must not have a realm reachability check gating its completion.
    // Realm reachability (setRuntimeReachable) is set AFTER the bootstrap body,
    // not as a precondition that could block the async function.
    const asyncBodyStart = bootstrapSource.indexOf('bootstrapPromise = (async ()');
    assert.ok(asyncBodyStart !== -1, 'async bootstrap body must exist');

    const setReachableIndex = bootstrapSource.indexOf('getOfflineCoordinator().markRuntimeReachable(daemonStatus.running)');
    assert.ok(setReachableIndex !== -1, 'markRuntimeReachable(daemonStatus.running) must appear in bootstrap source');

    // Runtime reachability should be marked after the core bootstrap steps
    // (after Runtime account projection), confirming realm connectivity is not a gate.
    const authSessionIndex = bootstrapSource.indexOf('getAccountSessionStatus({');
    assert.ok(authSessionIndex !== -1, 'Runtime account projection bootstrap must appear in bootstrap source');
    assert.ok(
      setReachableIndex > authSessionIndex,
      'markRuntimeReachable(daemonStatus.running) must appear after Runtime account projection bootstrap, confirming realm reachability is not a precondition',
    );
  });

  test('D-OFFLINE-001: bootstrap success sets runtime reachable', () => {
    const catchIndex = bootstrapSource.indexOf('.catch(async (error)');
    assert.ok(catchIndex !== -1, '.catch(async (error) block must exist');
    const successPath = bootstrapSource.slice(0, catchIndex);
    assert.ok(
      successPath.includes('getOfflineCoordinator().markRuntimeReachable(daemonStatus.running)'),
      'success path must call getOfflineCoordinator().markRuntimeReachable(daemonStatus.running)',
    );
  });

  test('D-OFFLINE-001: bootstrap failure sets runtime unreachable', () => {
    const catchIndex = bootstrapSource.indexOf('.catch(async (error)');
    assert.ok(catchIndex !== -1, '.catch(async (error) block must exist');
    const catchBlock = bootstrapSource.slice(catchIndex);
    assert.ok(
      catchBlock.includes('getOfflineCoordinator().markRuntimeReachable(false)'),
      'catch block must call getOfflineCoordinator().markRuntimeReachable(false)',
    );
  });

  test('D-OFFLINE-001: offline coordinator bindings are installed before bootstrap guard returns', () => {
    const bindIndex = bootstrapSource.indexOf('bindOfflineCoordinator();');
    const guardIndex = bootstrapSource.indexOf('if (bootstrapPromise)');
    assert.ok(bindIndex !== -1, 'bindOfflineCoordinator(); must appear in bootstrap source');
    assert.ok(guardIndex !== -1, 'if (bootstrapPromise) must appear in bootstrap source');
    assert.ok(
      bindIndex < guardIndex,
      'bindOfflineCoordinator() must run before the idempotent bootstrap guard returns, so failure paths still have listeners',
    );
  });

  test('D-BOOT-013: runtime unavailable stays non-fatal and still completes bootstrap', () => {
    assert.ok(
      bootstrapSource.includes('let runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);'),
      'bootstrap must classify runtimeUnavailable from runtime bridge status',
    );
    assert.ok(
      bootstrapSource.includes('if (desktopBridge.hasTauriInvoke() && runtimeUnavailable)'),
      'bootstrap must attempt to start the runtime bridge when runtime is unavailable',
    );
    assert.ok(
      bootstrapSource.includes('daemonStatus = await desktopBridge.startRuntimeBridge();'),
      'bootstrap must use the bridge start command before falling back to strip-only readiness',
    );
    assert.ok(
      bootstrapSource.includes("message: 'phase:runtime-unavailable:strip-only'"),
      'bootstrap must log runtime unavailable and rely on strip-only UI',
    );
    const runtimeUnavailableIndex = bootstrapSource.indexOf('if (runtimeUnavailable) {');
    const runtimeUnavailableBlockEnd = bootstrapSource.indexOf('if (bootstrapRuntimeConfigWarning) {');
    const successTail = bootstrapSource.slice(runtimeUnavailableIndex);
    const runtimeUnavailableBlock = bootstrapSource.slice(
      runtimeUnavailableIndex,
      runtimeUnavailableBlockEnd === -1 ? bootstrapSource.length : runtimeUnavailableBlockEnd,
    );
    assert.ok(
      successTail.includes('setBootstrapReady(true)'),
      'runtime unavailable path must still mark bootstrap ready',
    );
    assert.ok(
      successTail.includes('setBootstrapError(null)'),
      'runtime unavailable path must clear bootstrapError instead of failing startup',
    );
    assert.doesNotMatch(
      runtimeUnavailableBlock,
      /setStatusBanner\(\{\s*kind:\s*'warning'/,
      'runtime unavailable path must not emit a duplicate warning banner',
    );
  });

  test('D-BOOT-013: runtime config sync degradation excludes manual restart-required fail-close', () => {
    assert.ok(
      bootstrapSource.includes("message: 'phase:runtime-config-sync:degraded'"),
      'bootstrap must still log optional runtime config sync degradation',
    );
    assert.ok(
      bootstrapSource.includes("useAppStore.getState().setStatusBanner({\n        kind: 'warning',"),
      'bootstrap must still surface optional runtime config sync degradation as a warning banner',
    );
    assert.match(
      bootstrapSource,
      /if \(isRuntimeConfigManualRestartRequiredError\(error\)\) \{\s*throw error;\s*\}/,
      'manual restart-required runtime config sync errors must escape the degraded catch',
    );
    const degradedIndex = bootstrapSource.indexOf("message: 'phase:runtime-config-sync:degraded'");
    const readyIndex = bootstrapSource.indexOf('useAppStore.getState().setBootstrapReady(true);');
    assert.ok(degradedIndex !== -1, 'runtime config sync degraded log must exist');
    assert.ok(readyIndex !== -1, 'bootstrap ready assignment must exist');
    assert.ok(
      degradedIndex < readyIndex,
      'runtime config sync degradation must be handled before bootstrap completes',
    );
  });

  test('D-BOOT-014: retired shared auth bootstrap remains hard-blocked', () => {
    const authBootstrapPath = resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-auth.ts');
    const authBootstrapSource = readFileSync(authBootstrapPath, 'utf-8');
    assert.match(authBootstrapSource, /RuntimeAccountService owns local account truth/);
    assert.doesNotMatch(authBootstrapSource, /loadCurrentUser|persistSharedDesktopSession|withBootstrapStepTimeout/);
  });

  test('D-BOOT-015: non-critical runtime bootstrap work is timeout-bounded or deferred', () => {
    assert.ok(
      bootstrapSource.includes('NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS'),
      'bootstrap must define a timeout for non-critical startup work',
    );
    assert.ok(
      bootstrapSource.includes("step: 'post-ready runtime mod hydration'"),
      'runtime mod hydration must be treated as a post-ready deferred step',
    );
    assert.ok(
      bootstrapSource.includes("step: 'external agent action bridge startup'"),
      'external agent bridge startup must be treated as a non-critical deferred step',
    );
    assert.ok(
      bootstrapSource.includes("step: 'external agent descriptor resync'"),
      'external agent descriptor sync must be treated as a non-critical deferred step',
    );
  });

  test('D-BOOT-016: runtime local models config sync runs before runtime jwt sync', () => {
    const localModelsSyncIndex = bootstrapSource.indexOf('syncRuntimeLocalModelsConfig({');
    const jwtSyncIndex = bootstrapSource.indexOf('syncRuntimeJwtConfig({');
    assert.ok(localModelsSyncIndex !== -1, 'syncRuntimeLocalModelsConfig({ must appear in bootstrap source');
    assert.ok(jwtSyncIndex !== -1, 'syncRuntimeJwtConfig({ must appear in bootstrap source');
    assert.ok(
      localModelsSyncIndex < jwtSyncIndex,
      'runtime local models config sync must run before runtime jwt sync',
    );
  });
});
