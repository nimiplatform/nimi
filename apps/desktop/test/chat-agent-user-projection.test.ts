import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentUserProjection } from '../src/shell/renderer/features/chat/chat-agent-user-projection.js';

test('agent user projection assigns unique message ids for text plus images', () => {
  const projection = buildAgentUserProjection({
    threadId: 'thread-1',
    agentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-user-1',
    submittedText: 'Please inspect these.',
    uploadedAttachments: [{
      kind: 'image',
      mediaUrl: 'data:image/png;base64,aW1hZ2UtMQ==',
      mediaMimeType: 'image/png',
      artifactId: 'artifact-1',
    }, {
      kind: 'image',
      mediaUrl: 'data:image/png;base64,aW1hZ2UtMg==',
      mediaMimeType: 'image/png',
      artifactId: 'artifact-2',
    }],
    createdAtMs: 100,
  });

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
  assert.equal(projection.messages[1]?.mediaUrl, 'data:image/png;base64,aW1hZ2UtMQ==');
  assert.equal(projection.messages[1]?.mediaMimeType, 'image/png');
  assert.equal(projection.messages[1]?.artifactId, 'artifact-1');
  assert.equal(projection.firstMessageId, 'turn-user-1:message:0');
  assert.equal(projection.lastMessageId, 'turn-user-1:message:2');
  assert.equal(projection.lastMessageAtMs, 102);
});

test('agent user projection supports attachment-only turns', () => {
  const projection = buildAgentUserProjection({
    threadId: 'thread-1',
    agentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-user-2',
    submittedText: '   ',
    uploadedAttachments: [{
      kind: 'image',
      mediaUrl: 'data:image/png;base64,aW1hZ2Utb25seQ==',
      mediaMimeType: 'image/png',
      artifactId: 'artifact-image-only',
    }],
    createdAtMs: 200,
  });

  assert.equal(projection.messages[0]?.kind, 'image');
  assert.equal(projection.messages[0]?.parentMessageId, null);
  assert.equal(projection.messages[0]?.artifactId, 'artifact-image-only');
  assert.equal(projection.lastMessageId, 'turn-user-2:message:0');
});
