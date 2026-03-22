import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const bootstrapSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts', import.meta.url),
  'utf8',
);

const externalAgentSource = readFileSync(
  new URL('../src/runtime/external-agent/index.ts', import.meta.url),
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
    bootstrapSource.includes('stopExternalAgentActionBridge();'),
    'teardown helper must stop external agent bridge',
  );
  assert.ok(
    bootstrapSource.includes('resetRuntimeHostState();'),
    'teardown helper must reset runtime host state',
  );
  assert.ok(
    bootstrapSource.includes('clearInternalModSdkHost();'),
    'teardown helper must clear internal mod sdk host',
  );
});

test('external agent bridge stop clears descriptor sync residue', () => {
  const stopIndex = externalAgentSource.indexOf('export function stopExternalAgentActionBridge(): void {');
  assert.notEqual(stopIndex, -1, 'stopExternalAgentActionBridge() must exist');
  const stopBlock = externalAgentSource.slice(stopIndex, externalAgentSource.indexOf('export async function resyncExternalAgentActionDescriptors', stopIndex));
  assert.ok(
    stopBlock.includes("syncedActionHash = '';"),
    'stopping the external agent bridge must clear synced action hash so reconnect bootstrap resyncs descriptors',
  );
  assert.ok(
    stopBlock.includes('actionRegistryResyncQueued = false;'),
    'stopping the external agent bridge must clear queued descriptor resync state',
  );
});
