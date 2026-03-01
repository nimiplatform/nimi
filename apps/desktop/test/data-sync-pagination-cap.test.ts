import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const facadeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
  'utf8',
);

test('D-DSYNC-000: facade uses Math.min(limit, 100) for pagination cap', () => {
  const matches = facadeSource.match(/Math\.min\(\s*limit\s*,\s*100\s*\)/g) || [];
  assert.ok(
    matches.length >= 3,
    `Expected at least 3 pagination cap calls (Math.min(limit, 100)), found ${matches.length}`,
  );
});

test('D-DSYNC-000: no limit parameter exceeds 100 in default values', () => {
  // Check default limits in method signatures - they should not exceed 100
  const defaultLimitPattern = /limit\s*[=:]\s*(\d+)/g;
  let match;
  while ((match = defaultLimitPattern.exec(facadeSource)) !== null) {
    const value = Number(match[1]);
    if (value > 100) {
      assert.fail(`Found default limit > 100: ${match[0]}`);
    }
  }
});
