import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createRealmChatResourceAttachmentPayload as createCanonicalChatAttachmentPayload,
  extractRealmChatAttachmentTargetId as extractChatAttachmentTargetId,
  resolveRealmChatAttachmentPreviewText as resolveCanonicalChatAttachmentPreviewText,
  resolveRealmChatMediaUrl as resolveCanonicalChatAttachmentUrl,
} from '@nimiplatform/kit/features/chat/realm';

const messageTimelineUtilsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/turns/message-timeline-utils.tsx'),
  'utf8',
);
const chatAttachmentContractPath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/turns/chat-attachment-contract.ts',
);
const humanComposerSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/chat/chat-human-canonical-composer-profile.tsx'),
  'utf8',
);
const humanComponentsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/chat/chat-human-canonical-components.tsx'),
  'utf8',
);

test('chat attachment payloads are canonical resource-backed writes', () => {
  assert.deepEqual(createCanonicalChatAttachmentPayload(' resource-1 '), {
    attachment: {
      targetType: 'RESOURCE',
      targetId: 'resource-1',
    },
  });
  assert.throws(() => createCanonicalChatAttachmentPayload(''), /chat-attachment-target-id-required/);
});

test('chat attachment uploads require resourceId from the direct upload session', () => {
  assert.equal(extractChatAttachmentTargetId({ resourceId: 'resource-2' } as never), 'resource-2');
  assert.throws(() => extractChatAttachmentTargetId({ storageRef: 'legacy-ref' } as never), /chat-attachment-target-id-required/);
});

test('chat attachment playback resolves canonical attachment urls and nested previews without legacy ids', () => {
  assert.equal(
    resolveCanonicalChatAttachmentUrl({
      attachment: { url: 'https://cdn.example.com/media.mp4' },
      imageId: 'legacy-image',
    }, ''),
    'https://cdn.example.com/media.mp4',
  );
  assert.equal(
    resolveCanonicalChatAttachmentUrl({ attachment: { url: '/resources/resource-1' } }, 'https://realm.example.com/'),
    'https://realm.example.com/resources/resource-1',
  );
  assert.equal(
    resolveCanonicalChatAttachmentUrl({
      attachment: {
        displayKind: 'CARD',
        preview: { url: '/resources/resource-preview-1' },
      },
    }, 'https://realm.example.com/'),
    'https://realm.example.com/resources/resource-preview-1',
  );
  assert.equal(resolveCanonicalChatAttachmentUrl({ imageId: 'legacy-image' }, 'https://realm.example.com'), '');
  assert.equal(resolveCanonicalChatAttachmentUrl({ videoId: 'legacy-video' }, 'https://realm.example.com'), '');
});

test('chat attachment preview text prefers canonical metadata and falls back to display kind', () => {
  assert.equal(
    resolveCanonicalChatAttachmentPreviewText({
      attachment: { title: 'Original Song', displayKind: 'CARD' },
    }),
    'Original Song',
  );
  assert.equal(
    resolveCanonicalChatAttachmentPreviewText({
      attachment: {
        displayKind: 'CARD',
        preview: { displayKind: 'IMAGE' },
      },
    }),
    'Image',
  );
  assert.equal(resolveCanonicalChatAttachmentPreviewText({ imageId: 'legacy-image' }), '');
});

test('message timeline utilities do not synthesize legacy media endpoints', () => {
  assert.match(messageTimelineUtilsSource, /resolveRealmChatMediaUrl/);
  assert.doesNotMatch(messageTimelineUtilsSource, /\/api\/media\/images\//);
  assert.doesNotMatch(messageTimelineUtilsSource, /\/api\/media\/videos\//);
  assert.doesNotMatch(messageTimelineUtilsSource, /\bimageId\b/);
  assert.doesNotMatch(messageTimelineUtilsSource, /\bvideoId\b/);
});

test('Desktop consumes Kit Realm chat attachment primitives directly', () => {
  assert.equal(fs.existsSync(chatAttachmentContractPath), false);
  for (const source of [messageTimelineUtilsSource, humanComposerSource, humanComponentsSource]) {
    assert.match(source, /@nimiplatform\/kit\/features\/chat\/realm/);
    assert.doesNotMatch(source, /chat-attachment-contract/);
  }
  assert.match(humanComposerSource, /createRealmChatResourceAttachmentPayload/);
  assert.match(humanComposerSource, /extractRealmChatAttachmentTargetId/);
  assert.match(humanComponentsSource, /resolveRealmChatMediaUrl/);
  assert.match(humanComponentsSource, /resolveRealmChatAttachmentPreviewText/);
});
