import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentUserProjectionCommit } from '../src/shell/renderer/features/chat/chat-agent-user-projection.js';

test('agent user projection commit assigns unique projection message ids per beat for text plus images', () => {
  const projection = buildAgentUserProjectionCommit({
    threadId: 'thread-1',
    turnId: 'turn-user-1',
    submittedText: 'Please inspect these.',
    uploadedAttachments: [{
      kind: 'image',
      url: 'https://cdn.nimi.test/image-1.png',
      mimeType: 'image/png',
      name: 'image-1.png',
      resourceId: 'resource-1',
    }, {
      kind: 'image',
      url: 'https://cdn.nimi.test/image-2.png',
      mimeType: 'image/png',
      name: 'image-2.png',
      resourceId: 'resource-2',
    }],
    createdAtMs: 100,
  });

  assert.deepEqual(
    projection.beats.map((beat) => beat.projectionMessageId),
    ['turn-user-1:message:0', 'turn-user-1:message:1', 'turn-user-1:message:2'],
  );
  assert.equal(new Set(projection.beats.map((beat) => beat.projectionMessageId)).size, projection.beats.length);
  assert.deepEqual(
    projection.messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      parentMessageId: message.parentMessageId,
      contentText: message.contentText,
    })),
    [{
      id: 'turn-user-1:message:0',
      kind: 'text',
      parentMessageId: null,
      contentText: 'Please inspect these.',
    }, {
      id: 'turn-user-1:message:1',
      kind: 'image',
      parentMessageId: 'turn-user-1:message:0',
      contentText: '',
    }, {
      id: 'turn-user-1:message:2',
      kind: 'image',
      parentMessageId: 'turn-user-1:message:1',
      contentText: '',
    }],
  );
  assert.equal(projection.firstMessageId, 'turn-user-1:message:0');
  assert.equal(projection.lastMessageId, 'turn-user-1:message:2');
  assert.equal(projection.lastMessageAtMs, 102);
});

test('agent user projection commit supports attachment-only turns', () => {
  const projection = buildAgentUserProjectionCommit({
    threadId: 'thread-1',
    turnId: 'turn-user-2',
    submittedText: '   ',
    uploadedAttachments: [{
      kind: 'image',
      url: 'https://cdn.nimi.test/image-only.png',
      mimeType: 'image/png',
      name: 'image-only.png',
      resourceId: 'resource-image-only',
    }],
    createdAtMs: 200,
  });

  assert.deepEqual(
    projection.beats.map((beat) => beat.projectionMessageId),
    ['turn-user-2:message:0'],
  );
  assert.equal(projection.messages[0]?.kind, 'image');
  assert.equal(projection.messages[0]?.parentMessageId, null);
  assert.equal(projection.lastMessageId, 'turn-user-2:message:0');
});
