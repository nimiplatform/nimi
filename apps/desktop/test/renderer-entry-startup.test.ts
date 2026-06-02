import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assert } from './desktop-macos-smoke-test-helpers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRendererMain(): string {
  return fs.readFileSync(path.join(root, 'src/shell/renderer/main.tsx'), 'utf8');
}

test('renderer entry never mounts the root with a null Suspense fallback', () => {
  const source = readRendererMain();

  assert.match(source, /class EntryErrorBoundary extends React\.Component/);
  assert.match(source, /createRendererEntryModuleLoader/);
  assert.match(source, /const loadEntryModule = entryModuleLoader\.load;/);
  assert.match(source, /function preflightRendererAppDependencies/);
  assert.match(source, /DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS/);
  assert.match(source, /describeRendererEntryFailureReason/);
  assert.match(source, /entry:renderer-app/);
  assert.match(source, /entry:app-routes/);
  assert.match(source, /entry:sdk-ai/);
  assert.match(source, /renderer-app-import-failed/);
  assert.match(source, /renderer-entry-boundary-caught/);
  assert.match(source, /function EntryRuntimeBootSurface/);
  assert.match(source, /<Suspense\s+fallback=\{<EntryRuntimeBootSurface/);
  assert.doesNotMatch(source, /EntrySplashSurface/);
  assert.doesNotMatch(source, /entrySplashTitle|entrySplashDetail/);
  assert.doesNotMatch(source, /createRoot\(rootElement\)\.render\(<Suspense fallback=\{null\}>/);
});
