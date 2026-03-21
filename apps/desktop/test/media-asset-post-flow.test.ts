import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { extractExistingMediaId } from '../src/shell/renderer/features/profile/create-post-modal-helpers';

const createPostModalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/profile/create-post-modal.tsx'),
  'utf8',
);

test('extractExistingMediaId only accepts canonical media ids from the editable post seed', () => {
  assert.equal(
    extractExistingMediaId({
      id: 'asset-1',
      type: 'image',
    } as never),
    'asset-1',
  );
  assert.equal(
    extractExistingMediaId({
      id: 'asset-video-1',
      type: 'video',
    } as never),
    'asset-video-1',
  );
  assert.equal(extractExistingMediaId(null), '');
});

test('create post modal writes assetId-only media payloads for new posts', () => {
  assert.match(createPostModalSource, /media:\s*\[\{\s*type:\s*mediaType,\s*assetId:\s*mediaId,\s*\}\]/s);
  assert.doesNotMatch(createPostModalSource, /createPost\(\{\s*media:\s*\[\{[\s\S]*imageId:/s);
  assert.doesNotMatch(createPostModalSource, /createPost\(\{\s*media:\s*\[\{[\s\S]*videoId:/s);
});

test('create post modal calls finalizeMediaAsset after direct upload', () => {
  assert.match(createPostModalSource, /finalizeMediaAsset\(/);
});

test('create post modal revokes blob preview URLs on unmount', () => {
  assert.match(createPostModalSource, /return \(\) => \{\s*if \(selectedFileRef\.current\) \{\s*URL\.revokeObjectURL\(selectedFileRef\.current\.previewUrl\);/s);
});

test('create post modal closes and resets preview state before background upload starts', () => {
  assert.match(createPostModalSource, /onUploadStart\?\.\(\);[\s\S]*handleClose\(\);[\s\S]*try \{/);
});
