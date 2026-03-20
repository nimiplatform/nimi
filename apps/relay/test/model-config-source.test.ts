import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mediaRouteSelectorSource = readFileSync(
  path.join(testDir, '..', 'src', 'renderer', 'features', 'model-config', 'media-route-selector.tsx'),
  'utf-8',
);

describe('media-route-selector source regressions', () => {
  it('does not auto-commit route changes during option loading', () => {
    assert.ok(
      !mediaRouteSelectorSource.includes('onChangeRef.current('),
      'selector should not call onChange from the loading effect',
    );
    assert.ok(
      !mediaRouteSelectorSource.includes('Auto-commit resolved connector'),
      'selector should not include auto-commit-on-mount behavior',
    );
  });
});
