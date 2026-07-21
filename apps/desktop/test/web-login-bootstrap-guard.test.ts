import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const productionBindingsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/renderer/production-bindings.ts'),
  'utf8',
);

test('web login shell does not start runtime health coordinator before a platform client exists', () => {
  assert.match(
    productionBindingsSource,
    /connectRuntimeHealthCoordinator\(\s*lifecycle,\s*getShellFeatureFlags\(\)\.mode === 'desktop',\s*\)/s,
  );
  assert.doesNotMatch(productionBindingsSource, /connectRuntimeHealthCoordinator\(lifecycle, true\)/);
});
