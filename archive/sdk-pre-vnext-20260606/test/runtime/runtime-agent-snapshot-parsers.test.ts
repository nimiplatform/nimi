import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSessionSnapshot } from '../../src/runtime/runtime-agent-snapshot-parsers.js';

test('runtime agent session snapshot parser requires Runtime replay envelope for transcript', () => {
  const snapshot = parseSessionSnapshot({
    transcript_message_count: 2,
    transcript: [
      {
        id: 'anchor-1:transcript:0',
        role: 'user',
        content: 'hello',
        status: 'complete',
        kind: 'text',
        created_at: '2026-05-27T00:00:00Z',
        updated_at: '2026-05-27T00:00:00Z',
      },
      {
        role: 'assistant',
        content: 'missing replay envelope',
      },
    ],
  });

  assert.equal(snapshot.transcript, undefined);
  assert.equal(snapshot.transcriptMessageCount, 2);
});

test('runtime agent session snapshot parser preserves Runtime replay parent binding', () => {
  const snapshot = parseSessionSnapshot({
    transcript_message_count: 2,
    transcript: [
      {
        id: 'anchor-1:transcript:0',
        role: 'user',
        content: 'hello',
        status: 'complete',
        kind: 'text',
        created_at: '2026-05-27T00:00:00Z',
        updated_at: '2026-05-27T00:00:00Z',
      },
      {
        id: 'anchor-1:transcript:1',
        role: 'assistant',
        content: 'hi there',
        status: 'complete',
        kind: 'text',
        created_at: '2026-05-27T00:00:00.001Z',
        updated_at: '2026-05-27T00:00:00.001Z',
        parent_message_id: 'anchor-1:transcript:0',
      },
    ],
  });

  assert.deepEqual(snapshot.transcript?.map((message) => ({
    id: message.id,
    parentMessageId: message.parentMessageId,
    createdAt: message.createdAt,
  })), [
    {
      id: 'anchor-1:transcript:0',
      parentMessageId: undefined,
      createdAt: '2026-05-27T00:00:00Z',
    },
    {
      id: 'anchor-1:transcript:1',
      parentMessageId: 'anchor-1:transcript:0',
      createdAt: '2026-05-27T00:00:00.001Z',
    },
  ]);
});
