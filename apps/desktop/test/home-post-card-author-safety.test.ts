import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const postCardSource = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'src/shell/renderer/features/home/post-card.tsx'),
  'utf8',
);

test('home PostCard treats missing author projection as renderable data', () => {
  assert.doesNotMatch(postCardSource, /post\.author\.(avatarUrl|displayName|handle|id)/);
  assert.match(postCardSource, /post\.author\?\.avatarUrl/);
  assert.match(postCardSource, /post\.author\?\.displayName/);
  assert.match(postCardSource, /post\.author\?\.handle/);
});
