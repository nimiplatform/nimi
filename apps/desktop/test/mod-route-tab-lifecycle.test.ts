import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SLOT_CONTEXT_PATH = resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/host/slot-context.ts');
const SYNC_RUNTIME_EXTENSIONS_PATH = resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/lifecycle/sync-runtime-extensions.tsx');
const ROUTE_LIFECYCLE_PATH = resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/lifecycle/route-lifecycle.ts');

test('route tab pages keep opened mod tabs mounted and stop using LRU eviction', () => {
  const contextSource = readFileSync(SLOT_CONTEXT_PATH, 'utf-8');
  const syncSource = readFileSync(SYNC_RUNTIME_EXTENSIONS_PATH, 'utf-8');
  const routeLifecycleSource = readFileSync(ROUTE_LIFECYCLE_PATH, 'utf-8');

  assert.match(contextSource, /isModTabOpen: \(tabId\) => isRouteTabOpen/);
  assert.match(contextSource, /isModTabRetained/);
  assert.match(syncSource, /shouldMountRouteTab/);
  assert.doesNotMatch(syncSource, /activatedTabPages/);

  assert.match(contextSource, /getModLifecycleState/);
  assert.match(routeLifecycleSource, /return 'active'/);
  assert.match(routeLifecycleSource, /return 'background-throttled'/);
  assert.match(routeLifecycleSource, /return 'discarded'/);
  assert.match(routeLifecycleSource, /return isRouteTabOpen\(tabId, modWorkspaceTabs\)/);
  assert.match(syncSource, /data-lifecycle-state/);
});
