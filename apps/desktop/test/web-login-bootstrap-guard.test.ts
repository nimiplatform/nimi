import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/App.tsx'),
  'utf8',
);

test('web login shell does not start runtime health coordinator before a platform client exists', () => {
  assert.match(appSource, /const shellMode = getShellFeatureFlags\(\)\.mode;/);
  assert.match(
    appSource,
    /const runtimeHealthBootstrapEnabled = shellMode === 'desktop' && bootstrapReady(?: && !standaloneWorldTour)?;/,
  );
  assert.match(appSource, /useRuntimeHealthCoordinatorBootstrap\(runtimeHealthBootstrapEnabled\);/);
  assert.doesNotMatch(appSource, /useRuntimeHealthCoordinatorBootstrap\(bootstrapReady\);/);
});
