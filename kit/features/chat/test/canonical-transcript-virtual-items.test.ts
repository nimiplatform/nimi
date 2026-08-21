import { describe, expect, it } from 'vitest';
import { buildCanonicalTranscriptVirtualItems } from '../src/components/canonical-transcript-virtual-items.js';
import type { ConversationCanonicalMessage } from '../src/types.js';

function createMessage(
  id: string,
  createdAt: string,
  role: ConversationCanonicalMessage['role'] = 'agent',
): ConversationCanonicalMessage {
  return {
    id,
    sessionId: 'session-1',
    targetId: 'agent:one',
    source: 'agent',
    role,
    text: `text-${id}`,
    createdAt,
    updatedAt: createdAt,
    status: 'complete',
    kind: 'text',
    senderName: 'Agent',
    senderKind: 'agent',
  };
}

describe('buildCanonicalTranscriptVirtualItems', () => {
  it('skips date separators for messages without a parseable timestamp', () => {
    const items = buildCanonicalTranscriptVirtualItems([
      createMessage('m1', '', 'user'),
      createMessage('m2', ''),
      createMessage('m3', '', 'user'),
    ]);

    expect(items.every((item) => item.type === 'message')).toBe(true);
    expect(items).toHaveLength(3);
  });

  it('still emits date separators around timestamped messages', () => {
    const items = buildCanonicalTranscriptVirtualItems([
      createMessage('m1', ''),
      createMessage('m2', '2026-04-05T00:00:00.000Z'),
      createMessage('m3', '2026-04-06T00:00:00.000Z'),
    ]);

    const separators = items.filter((item) => item.type === 'date');
    expect(separators).toHaveLength(2);
    expect(items.filter((item) => item.type === 'message')).toHaveLength(3);
  });
});
