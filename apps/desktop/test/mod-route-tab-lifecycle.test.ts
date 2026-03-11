import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SLOT_CONTEXT_PATH = resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/host/slot-context.ts');
const SYNC_RUNTIME_EXTENSIONS_PATH = resolve(import.meta.dirname, '../src/shell/renderer/mod-ui/lifecycle/sync-runtime-extensions.tsx');

test('route tab pages stay mounted only while the mod tab remains open', () => {
  const contextSource = readFileSync(SLOT_CONTEXT_PATH, 'utf-8');
  const syncSource = readFileSync(SYNC_RUNTIME_EXTENSIONS_PATH, 'utf-8');

  assert.match(contextSource, /isModTabOpen: \(tabId\) => modWorkspaceTabs\.some/);
  assert.match(syncSource, /const keepMounted = context\.isModTabOpen/);
  assert.match(syncSource, /if \(!active && !keepMounted\) \{/);
  assert.doesNotMatch(syncSource, /activatedTabPages/);
});
