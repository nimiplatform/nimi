import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BOOTSTRAP_PATH = resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts');
const bootstrapSource = readFileSync(BOOTSTRAP_PATH, 'utf-8');

describe('bootstrap sequence ordering (D-BOOT)', () => {
  test('D-BOOT-001: bootstrap loads runtime defaults before platform client init', () => {
    const defaultsIndex = bootstrapSource.indexOf('getRuntimeDefaults()');
    const platformClientIndex = bootstrapSource.indexOf('initializePlatformClient(');
    assert.ok(defaultsIndex !== -1, 'getRuntimeDefaults() must appear in bootstrap source');
    assert.ok(platformClientIndex !== -1, 'initializePlatformClient( must appear in bootstrap source');
    assert.ok(
      defaultsIndex < platformClientIndex,
      `getRuntimeDefaults() (pos ${defaultsIndex}) must appear before initializePlatformClient( (pos ${platformClientIndex})`,
    );
  });

  test('D-BOOT-002: platform client init precedes DataSync init', () => {
    const platformClientIndex = bootstrapSource.indexOf('initializePlatformClient(');
    const dataSyncIndex = bootstrapSource.indexOf('dataSync.initApi(');
    assert.ok(platformClientIndex !== -1, 'initializePlatformClient( must appear in bootstrap source');
    assert.ok(dataSyncIndex !== -1, 'dataSync.initApi( must appear in bootstrap source');
    assert.ok(
      platformClientIndex < dataSyncIndex,
      `initializePlatformClient( (pos ${platformClientIndex}) must appear before dataSync.initApi( (pos ${dataSyncIndex})`,
    );
  });

  test('D-BOOT-004: runtime host assembly gated by enableRuntimeBootstrap flag', () => {
    assert.ok(
      bootstrapSource.includes('flags.enableRuntimeBootstrap'),
      'bootstrap must gate runtime host assembly behind flags.enableRuntimeBootstrap',
    );
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

    const setReachableIndex = bootstrapSource.indexOf('getOfflineCoordinator().markRuntimeReachable(true)');
    assert.ok(setReachableIndex !== -1, 'markRuntimeReachable(true) must appear in bootstrap source');

    // setRuntimeReachable(true) should appear after the core bootstrap steps
    // (after bootstrapAuthSession), confirming realm connectivity is not a gate.
    const authSessionIndex = bootstrapSource.indexOf('bootstrapAuthSession(');
    assert.ok(authSessionIndex !== -1, 'bootstrapAuthSession must appear in bootstrap source');
    assert.ok(
      setReachableIndex > authSessionIndex,
      'markRuntimeReachable(true) must appear after bootstrapAuthSession, confirming realm reachability is not a precondition',
    );
  });

  test('D-OFFLINE-001: bootstrap success sets runtime reachable', () => {
    const catchIndex = bootstrapSource.indexOf('.catch((error)');
    assert.ok(catchIndex !== -1, '.catch((error) block must exist');
    const successPath = bootstrapSource.slice(0, catchIndex);
    assert.ok(
      successPath.includes('getOfflineCoordinator().markRuntimeReachable(true)'),
      'success path must call getOfflineCoordinator().markRuntimeReachable(true)',
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
});
