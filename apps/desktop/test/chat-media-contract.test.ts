import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createCanonicalChatMediaPayload,
  extractChatMediaAssetId,
  resolveCanonicalChatMediaUrl,
} from '../src/shell/renderer/features/turns/chat-media-contract.ts';

const turnInputSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/turns/turn-input.tsx'),
  'utf8',
);
const messageTimelineUtilsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/turns/message-timeline-utils.tsx'),
  'utf8',
);

test('chat media payloads are canonical asset-backed writes', () => {
  assert.deepEqual(createCanonicalChatMediaPayload(' asset-1 '), { assetId: 'asset-1' });
  assert.throws(() => createCanonicalChatMediaPayload(''), /chat-media-asset-id-required/);
});

test('chat media uploads require assetId from the direct upload session', () => {
  assert.equal(extractChatMediaAssetId({ assetId: 'asset-2', storageRef: 'legacy-ref' } as never), 'asset-2');
  assert.throws(() => extractChatMediaAssetId({ storageRef: 'legacy-ref' } as never), /chat-media-asset-id-required/);
});

test('chat media playback resolves only canonical payload.url values', () => {
  assert.equal(
    resolveCanonicalChatMediaUrl({ url: 'https://cdn.example.com/media.mp4', imageId: 'legacy-image' }, ''),
    'https://cdn.example.com/media.mp4',
  );
  assert.equal(
    resolveCanonicalChatMediaUrl({ url: '/media/assets/asset-1' }, 'https://realm.example.com/'),
    'https://realm.example.com/media/assets/asset-1',
  );
  assert.equal(resolveCanonicalChatMediaUrl({ imageId: 'legacy-image' }, 'https://realm.example.com'), '');
  assert.equal(resolveCanonicalChatMediaUrl({ videoId: 'legacy-video' }, 'https://realm.example.com'), '');
});

test('turn input writes assetId-only chat media payloads', () => {
  assert.match(turnInputSource, /extractChatMediaAssetId\(uploadInfo\)/);
  assert.match(turnInputSource, /createCanonicalChatMediaPayload\(mediaAssetId\)/);
  assert.doesNotMatch(turnInputSource, /\bimageId\s*:/);
  assert.doesNotMatch(turnInputSource, /\bvideoId\s*:/);
  assert.doesNotMatch(turnInputSource, /storageRef/);
});

test('message timeline utilities do not synthesize legacy media endpoints', () => {
  assert.match(messageTimelineUtilsSource, /resolveCanonicalChatMediaUrl/);
  assert.doesNotMatch(messageTimelineUtilsSource, /\/api\/media\/images\//);
  assert.doesNotMatch(messageTimelineUtilsSource, /\/api\/media\/videos\//);
  assert.doesNotMatch(messageTimelineUtilsSource, /\bimageId\b/);
  assert.doesNotMatch(messageTimelineUtilsSource, /\bvideoId\b/);
});
