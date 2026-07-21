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
    bootstrapSource.includes(
      'if (rebootstrapPromise) {\n    return rebootstrapPromise;\n  }\n  return startBootstrapRuntime(lifecycle);',
    ),
    'public bootstrap must wait on queued rebootstrap before starting another bootstrap',
  );
  assert.ok(
    bootstrapSource.includes('await startBootstrapRuntime(lifecycle);'),
    'rebootstrap must call the internal bootstrap executor instead of awaiting its own public promise',
  );
  const internalBootstrapStart = bootstrapSource.indexOf(
    'function startBootstrapRuntime(lifecycle: DesktopRendererLifecyclePort): Promise<void>',
  );
  const internalBootstrapBody = bootstrapSource.slice(
    internalBootstrapStart,
    bootstrapSource.indexOf('bootstrapPromise = (async () => {', internalBootstrapStart),
  );
  assert.notEqual(internalBootstrapStart, -1, 'internal bootstrap executor must exist');
  assert.doesNotMatch(
    internalBootstrapBody,
    /rebootstrapPromise/,
    'internal bootstrap executor must not return the in-flight rebootstrap promise',
  );
  assert.ok(
    !bootstrapSource.includes('bootstrapPromise = null;\n  return bootstrapRuntime();'),
    'rebootstrap must not reset bootstrapPromise and recurse inline',
  );
});

test('bootstrap failure performs teardown before projecting Runtime account unavailable', () => {
  const catchIndex = bootstrapSource.indexOf('})().catch(async (error) => {');
  assert.notEqual(catchIndex, -1, 'bootstrap catch block must exist');
  const catchBlock = bootstrapSource.slice(catchIndex);
  const teardownIndex = catchBlock.indexOf('await teardownBootstrapState();');
  const unavailableProjectionIndex = catchBlock.indexOf('applyRuntimeAccountUnavailableProjection(lifecycle);');
  assert.notEqual(teardownIndex, -1, 'bootstrap catch must teardown runtime state');
  assert.notEqual(unavailableProjectionIndex, -1, 'bootstrap catch must project unavailable account state');
  assert.ok(
    teardownIndex < unavailableProjectionIndex,
    'bootstrap catch must teardown runtime state before projecting unavailable to avoid duplicate watcher effects',
  );
  assert.doesNotMatch(catchBlock, /clearAuthSession\(\)/);
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

test('runtime config bootstrap is observation-only after Runtime custody hardcut', () => {
  assert.match(bootstrapConfigSyncSource, /Runtime owns security-sensitive configuration/);
  assert.match(bootstrapConfigSyncSource, /daemonStatus: input\.daemonStatus/);
  assert.match(bootstrapConfigSyncSource, /bootstrapRuntimeConfigWarning: null/);
  assert.doesNotMatch(bootstrapConfigSyncSource, /setRuntimeConfig|getRuntimeConfig/);
});

test('runtime config bootstrap never owns Runtime restart', () => {
  assert.match(bootstrapConfigSyncSource, /runtimeUnavailable: runtimeDaemonUnavailable\(input\.daemonStatus\)/);
  assert.doesNotMatch(bootstrapConfigSyncSource, /startRuntimeBridge|restartRuntime|manual-restart-required/);
});

test('external agent runtime facade is deleted with no desktop action bridge residue', () => {
  assert.equal(existsSync(new URL('../src/runtime/external-agent/index.ts', import.meta.url)), false);
  assert.doesNotMatch(
    bootstrapSource,
    /stopExternalAgentActionBridge|syncedActionHash|actionRegistryResyncQueued|resyncExternalAgentActionDescriptors|external_agent_sync_action_descriptors/,
    'desktop must not own external agent action bridge or action descriptor sync',
  );
});
