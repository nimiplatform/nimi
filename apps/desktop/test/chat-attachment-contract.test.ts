import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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
