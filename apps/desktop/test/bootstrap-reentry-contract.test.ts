import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const bootstrapSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts', import.meta.url),
  'utf8',
);
const bootstrapConfigSyncSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap-config-sync.ts', import.meta.url),
  'utf8',
);

test('bootstrap re-entry is queued instead of resetting bootstrapPromise inline', () => {
  assert.ok(
    bootstrapSource.includes('let rebootstrapPromise: Promise<void> | null = null;'),
    'bootstrap must track an in-flight rebootstrap promise',
  );
  assert.ok(
    bootstrapSource.includes('let pendingRebootstrap = false;'),
    'bootstrap must track queued rebootstrap intent',
  );
  assert.ok(
    bootstrapSource.includes('while (pendingRebootstrap)'),
    'rebootstrap must drain queued restart requests serially',
  );
  assert.ok(
    bootstrapSource.includes('if (rebootstrapPromise) {\n    return rebootstrapPromise;\n  }\n  if (bootstrapPromise) {'),
    'bootstrap must wait on queued rebootstrap before returning an existing bootstrap promise',
  );
  assert.ok(
    !bootstrapSource.includes('bootstrapPromise = null;\n  return bootstrapRuntime();'),
    'rebootstrap must not reset bootstrapPromise and recurse inline',
  );
});

test('bootstrap failure performs teardown before auth reset and surfaces cleanup in source', () => {
  const catchIndex = bootstrapSource.indexOf('})().catch(async (error) => {');
  assert.notEqual(catchIndex, -1, 'bootstrap catch block must exist');
  const catchBlock = bootstrapSource.slice(catchIndex);
  const teardownIndex = catchBlock.indexOf('await teardownBootstrapState();');
  const clearAuthIndex = catchBlock.indexOf('useAppStore.getState().clearAuthSession();');
  assert.notEqual(teardownIndex, -1, 'bootstrap catch must teardown runtime state');
  assert.notEqual(clearAuthIndex, -1, 'bootstrap catch must clear auth state');
  assert.ok(
    teardownIndex < clearAuthIndex,
    'bootstrap catch must teardown runtime state before clearing auth to avoid duplicate auth-reset effects',
  );
  assert.ok(
    bootstrapSource.includes('stopAuthStateWatcher();'),
    'teardown helper must stop auth state watcher',
  );
  assert.ok(
    bootstrapSource.includes('clearDesktopNimiClientSession();'),
    'teardown helper must clear Desktop Nimi client session state',
  );
  assert.doesNotMatch(
    bootstrapSource,
    /stopExternalAgentActionBridge/,
    'bootstrap teardown must not retain a Desktop-owned external agent action bridge stop hook',
  );
});

test('fresh first-run storage sync skip does not surface a runtime config warning', () => {
  assert.match(bootstrapConfigSyncSource, /isFirstRunDataRootSelectionPendingMessage/);
  assert.match(bootstrapConfigSyncSource, /phase:runtime-config-sync:skipped-first-run-data-root/);
  assert.match(bootstrapConfigSyncSource, /projection\.state === 'config_missing' \|\| projection\.state === 'data_root_missing'/);
  assert.match(bootstrapConfigSyncSource, /if \(warning\) bootstrapRuntimeConfigWarning = bootstrapRuntimeConfigWarning \?\? warning/);
});

test('external runtime manual restart is degraded by error code instead of action-hint text', () => {
  assert.match(bootstrapConfigSyncSource, /isRuntimeConfigManualRestartRequiredError/);
  assert.doesNotMatch(bootstrapConfigSyncSource, /isManualRestartRequiredMessage/);
  assert.match(bootstrapConfigSyncSource, /phase:runtime-config-sync:manual-restart-required/);
  assert.match(bootstrapConfigSyncSource, /return message;/);
});

test('external agent runtime facade is deleted with no desktop action bridge residue', () => {
  assert.equal(existsSync(new URL('../src/runtime/external-agent/index.ts', import.meta.url)), false);
  assert.doesNotMatch(
    bootstrapSource,
    /stopExternalAgentActionBridge|syncedActionHash|actionRegistryResyncQueued|resyncExternalAgentActionDescriptors|external_agent_sync_action_descriptors/,
    'desktop must not own external agent action bridge or action descriptor sync',
  );
});
