import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('profile media tab consumes shared post feed flow instead of calling realm post service directly', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/features/profile/media-tab.tsx'),
    'utf8',
  );

  assert.match(source, /dataSync\.loadPostFeed/);
  assert.doesNotMatch(source, /PostService\.getHomeFeed/);
});
