import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const createPostModalHelpersSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/profile/create-post-modal-helpers.ts'),
  'utf8',
);
const createPostModalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/profile/create-post-modal.tsx'),
  'utf8',
);
const postCardSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/post-card.tsx'),
  'utf8',
);

test('editable post seed uses attachment semantics instead of media semantics', () => {
  assert.match(createPostModalHelpersSource, /attachment\?:\s*\{\s*id:\s*string;/s);
  assert.match(createPostModalHelpersSource, /export function extractExistingAttachmentTargetId/);
  assert.doesNotMatch(createPostModalHelpersSource, /\bmedia\?:\s*\{/);
  assert.doesNotMatch(createPostModalHelpersSource, /extractExistingMediaId/);
});

test('create post modal writes targetType-targetId attachments payloads for new posts', () => {
  assert.match(createPostModalSource, /attachments:\s*\[\{\s*targetType:\s*'RESOURCE',\s*targetId:\s*resourceId,\s*\}\]/s);
  assert.doesNotMatch(createPostModalSource, /createPost\(\{\s*attachments:\s*\[\{[\s\S]*imageId:/s);
  assert.doesNotMatch(createPostModalSource, /createPost\(\{\s*attachments:\s*\[\{[\s\S]*videoId:/s);
});

test('create post modal calls finalizeResource after direct upload', () => {
  assert.match(createPostModalSource, /finalizeResource\(/);
});

test('create post modal revokes blob preview URLs on unmount', () => {
  assert.match(createPostModalSource, /return \(\) => \{\s*if \(selectedFileRef\.current\) \{\s*URL\.revokeObjectURL\(selectedFileRef\.current\.previewUrl\);/s);
});

test('create post modal closes and resets preview state before background upload starts', () => {
  assert.match(createPostModalSource, /onUploadStart\?\.\(\);[\s\S]*handleClose\(\);[\s\S]*try \{/);
});

test('post card fails closed when editing non-resource card attachments through the legacy editor', () => {
  assert.match(postCardSource, /if \(!canEditPostAttachment\) \{\s*setFeedback\(\{\s*kind:\s*'error',/s);
  assert.match(postCardSource, /Home\.editUnsupportedAttachment/);
  assert.match(postCardSource, /resource-backed image and video posts right now/);
  assert.match(postCardSource, /<InlineFeedback feedback=\{feedback\}/);
  assert.match(postCardSource, /canEditPost=\{canEditPostAttachment\}/);
});
