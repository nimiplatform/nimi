import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const exploreSectionNavSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/explore/explore-section-nav.tsx'),
  'utf8',
);

test('explore titlebar search input has an accessible name', () => {
  assert.match(
    exploreSectionNavSource,
    /aria-label=\{resolvedPlaceholder\}/,
    'visible search inputs must expose an accessible name instead of relying only on placeholder text',
  );
});
