import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const catalogPageSource = readFileSync(
  path.join(
    import.meta.dirname,
    '../src/shell/renderer/features/runtime-config/runtime-config-page-catalog.tsx',
  ),
  'utf8',
);

test('runtime model catalog does not render the provider count/source summary beside the selector', () => {
  assert.doesNotMatch(catalogPageSource, /ProviderCapabilities/u);
  assert.doesNotMatch(catalogPageSource, /modelCount\}\s*models/u);
  assert.doesNotMatch(catalogPageSource, /Built-in/u);
  assert.doesNotMatch(catalogPageSource, /Static catalog/u);
});
