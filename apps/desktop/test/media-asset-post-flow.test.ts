import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { extractExistingMediaId } from '../src/shell/renderer/features/profile/create-post-modal-helpers.ts';

const createPostModalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/profile/create-post-modal.tsx'),
  'utf8',
);

test('extractExistingMediaId prefers assetId and only falls back to legacy ids for playback', () => {
  assert.equal(
    extractExistingMediaId({
      id: 'legacy-id',
      assetId: 'asset-1',
      imageId: 'image-legacy',
      videoId: 'video-legacy',
      type: 'image',
    } as never),
    'asset-1',
  );
  assert.equal(
    extractExistingMediaId({
      id: 'legacy-id',
      videoId: 'video-legacy',
      type: 'video',
    } as never),
    'legacy-id',
  );
  assert.equal(
    extractExistingMediaId({
      uid: 'video-uid',
      type: 'video',
    } as never),
    'video-uid',
  );
  assert.equal(extractExistingMediaId(null), '');
});

test('create post modal writes assetId-only media payloads for new posts', () => {
  assert.match(createPostModalSource, /media:\s*\[\{\s*type:\s*mediaType,\s*assetId:\s*mediaId,\s*\}\]/s);
  assert.doesNotMatch(createPostModalSource, /createPost\(\{\s*media:\s*\[\{[\s\S]*imageId:/s);
  assert.doesNotMatch(createPostModalSource, /createPost\(\{\s*media:\s*\[\{[\s\S]*videoId:/s);
});
