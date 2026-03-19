import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BOOTSTRAP_PATH = resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts');
const bootstrapSource = readFileSync(BOOTSTRAP_PATH, 'utf-8');

describe('bootstrap sequence ordering (D-BOOT)', () => {
  test('D-BOOT-001: bootstrap loads runtime defaults before platform client init', () => {
    const defaultsIndex = bootstrapSource.indexOf('getRuntimeDefaults()');
    const platformClientIndex = bootstrapSource.indexOf('createPlatformClient(');
    assert.ok(defaultsIndex !== -1, 'getRuntimeDefaults() must appear in bootstrap source');
    assert.ok(platformClientIndex !== -1, 'createPlatformClient( must appear in bootstrap source');
    assert.ok(
      defaultsIndex < platformClientIndex,
      `getRuntimeDefaults() (pos ${defaultsIndex}) must appear before createPlatformClient( (pos ${platformClientIndex})`,
    );
  });

  test('D-BOOT-002: platform client init precedes DataSync init', () => {
    const platformClientIndex = bootstrapSource.indexOf('createPlatformClient(');
    const dataSyncIndex = bootstrapSource.indexOf('dataSync.initApi(');
    assert.ok(platformClientIndex !== -1, 'createPlatformClient( must appear in bootstrap source');
    assert.ok(dataSyncIndex !== -1, 'dataSync.initApi( must appear in bootstrap source');
    assert.ok(
      platformClientIndex < dataSyncIndex,
      `createPlatformClient( (pos ${platformClientIndex}) must appear before dataSync.initApi( (pos ${dataSyncIndex})`,
    );
  });

  test('D-BOOT-004: runtime host assembly gated by enableRuntimeBootstrap flag', () => {
    assert.ok(
      bootstrapSource.includes('flags.enableRuntimeBootstrap'),
      'bootstrap must gate runtime host assembly behind flags.enableRuntimeBootstrap',
    );
  });

  test('D-BOOT-005: runtime host assembly precedes runtime mod registration', () => {
    const hostCapabilitiesIndex = bootstrapSource.indexOf('buildRuntimeHostCapabilities(');
    const runtimeModsIndex = bootstrapSource.indexOf('registerBootstrapRuntimeMods({');
    assert.ok(hostCapabilitiesIndex !== -1, 'buildRuntimeHostCapabilities( must appear in bootstrap source');
    assert.ok(runtimeModsIndex !== -1, 'registerBootstrapRuntimeMods({ must appear in bootstrap source');
    assert.ok(
      hostCapabilitiesIndex < runtimeModsIndex,
      `buildRuntimeHostCapabilities( (pos ${hostCapabilitiesIndex}) must appear before registerBootstrapRuntimeMods({ (pos ${runtimeModsIndex})`,
    );
  });

  test('D-BOOT-006: external agent bridge starts after runtime mod registration', () => {
    const runtimeModsIndex = bootstrapSource.indexOf('registerBootstrapRuntimeMods({');
    const tier1ActionsIndex = bootstrapSource.indexOf('registerExternalAgentTier1Actions(hookRuntime);');
    const bridgeStartIndex = bootstrapSource.indexOf('await startExternalAgentActionBridge();');
    const descriptorSyncIndex = bootstrapSource.indexOf('await resyncExternalAgentActionDescriptors();');
    assert.ok(runtimeModsIndex !== -1, 'registerBootstrapRuntimeMods({ must appear in bootstrap source');
    assert.ok(tier1ActionsIndex !== -1, 'registerExternalAgentTier1Actions(hookRuntime); must appear in bootstrap source');
    assert.ok(bridgeStartIndex !== -1, 'await startExternalAgentActionBridge(); must appear in bootstrap source');
    assert.ok(descriptorSyncIndex !== -1, 'await resyncExternalAgentActionDescriptors(); must appear in bootstrap source');
    assert.ok(runtimeModsIndex < tier1ActionsIndex, 'external agent tier-1 action registration must happen after runtime mod registration');
    assert.ok(tier1ActionsIndex < bridgeStartIndex, 'action bridge must start after tier-1 action registration');
    assert.ok(bridgeStartIndex < descriptorSyncIndex, 'descriptor sync must happen after action bridge startup');
  });

  test('D-BOOT-007: auth bootstrap runs after runtime host work and before ready flag', () => {
    const descriptorSyncIndex = bootstrapSource.indexOf('await resyncExternalAgentActionDescriptors();');
    const authSessionIndex = bootstrapSource.indexOf('await bootstrapAuthSession({');
    const bootstrapReadyIndex = bootstrapSource.indexOf('useAppStore.getState().setBootstrapReady(true);');
    assert.ok(descriptorSyncIndex !== -1, 'await resyncExternalAgentActionDescriptors(); must appear in bootstrap source');
    assert.ok(authSessionIndex !== -1, 'await bootstrapAuthSession({ must appear in bootstrap source');
    assert.ok(bootstrapReadyIndex !== -1, 'setBootstrapReady(true); must appear in bootstrap source');
    assert.ok(descriptorSyncIndex < authSessionIndex, 'bootstrapAuthSession must run after runtime host setup and external agent sync');
    assert.ok(authSessionIndex < bootstrapReadyIndex, 'bootstrapAuthSession must complete before bootstrapReady is set');
  });

  test('D-BOOT-008: bootstrap failure sets bootstrapError and clears auth', () => {
    const catchIndex = bootstrapSource.indexOf('.catch((error)');
    assert.ok(catchIndex !== -1, '.catch((error) block must exist in bootstrap source');
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

    // setRuntimeReachable(true) should appear after the core bootstrap steps
    // (after bootstrapAuthSession), confirming realm connectivity is not a gate.
    const authSessionIndex = bootstrapSource.indexOf('bootstrapAuthSession(');
    assert.ok(authSessionIndex !== -1, 'bootstrapAuthSession must appear in bootstrap source');
    assert.ok(
      setReachableIndex > authSessionIndex,
      'markRuntimeReachable(daemonStatus.running) must appear after bootstrapAuthSession, confirming realm reachability is not a precondition',
    );
  });

  test('D-OFFLINE-001: bootstrap success sets runtime reachable', () => {
    const catchIndex = bootstrapSource.indexOf('.catch((error)');
    assert.ok(catchIndex !== -1, '.catch((error) block must exist');
    const successPath = bootstrapSource.slice(0, catchIndex);
    assert.ok(
      successPath.includes('getOfflineCoordinator().markRuntimeReachable(daemonStatus.running)'),
      'success path must call getOfflineCoordinator().markRuntimeReachable(daemonStatus.running)',
    );
  });

  test('D-OFFLINE-001: bootstrap failure sets runtime unreachable', () => {
    const catchIndex = bootstrapSource.indexOf('.catch((error)');
    assert.ok(catchIndex !== -1, '.catch((error) block must exist');
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
      bootstrapSource.includes('const runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);'),
      'bootstrap must classify runtimeUnavailable from runtime bridge status',
    );
    assert.ok(
      bootstrapSource.includes('if (desktopBridge.hasTauriInvoke() && !runtimeUnavailable)'),
      'bootstrap must skip runtime config sync when runtime is unavailable',
    );
    assert.ok(
      bootstrapSource.includes("message: daemonStatus.lastError || 'Runtime unavailable'"),
      'bootstrap must surface runtime unavailable as a warning banner',
    );
    const successTail = bootstrapSource.slice(bootstrapSource.indexOf('if (runtimeUnavailable) {'));
    assert.ok(
      successTail.includes('setBootstrapReady(true)'),
      'runtime unavailable path must still mark bootstrap ready',
    );
    assert.ok(
      successTail.includes('setBootstrapError(null)'),
      'runtime unavailable path must clear bootstrapError instead of failing startup',
    );
  });
});
