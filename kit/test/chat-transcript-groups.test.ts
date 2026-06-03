import { describe, expect, it } from 'vitest';

import type { ConversationCanonicalMessage } from '../features/chat/src/headless.js';
import {
  buildCanonicalTranscriptGroups,
  buildCanonicalTranscriptMessageGroups,
} from '../features/chat/src/headless.js';

function message(
  id: string,
  input: Partial<ConversationCanonicalMessage> = {},
): ConversationCanonicalMessage {
  return {
    id,
    sessionId: 'session-1',
    targetId: 'target-1',
    source: 'ai',
    role: 'assistant',
    text: id,
    createdAt: '2026-06-03T00:00:00.000Z',
    kind: 'text',
    ...input,
  };
}

describe('canonical transcript headless grouping', () => {
  it('groups contiguous same-role text messages within the transcript gap window', () => {
    const groups = buildCanonicalTranscriptMessageGroups([
      message('a1', { role: 'assistant', createdAt: '2026-06-03T00:00:00.000Z' }),
      message('a2', { role: 'assistant', createdAt: '2026-06-03T00:02:00.000Z' }),
      message('u1', { role: 'user', createdAt: '2026-06-03T00:02:30.000Z' }),
      message('a3', { role: 'assistant', createdAt: '2026-06-03T00:10:00.000Z' }),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0]?.items.map((item) => item.message.id)).toEqual(['a1', 'a2']);
    expect(groups[0]?.items.map((item) => item.position)).toEqual(['start', 'end']);
    expect(groups[0]?.items.map((item) => item.showAvatar)).toEqual([true, true]);
    expect(groups[0]?.items.map((item) => item.showTimestamp)).toEqual([false, true]);
    expect(groups[1]?.items[0]?.position).toBe('single');
    expect(groups[2]?.items[0]?.position).toBe('single');
  });

  it('starts a new group for streaming messages even when role and time match', () => {
    const groups = buildCanonicalTranscriptMessageGroups([
      message('a1', { role: 'assistant' }),
      message('a2-streaming', { role: 'assistant', kind: 'streaming' }),
      message('a3', { role: 'assistant' }),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.items[0]?.message.id)).toEqual(['a1', 'a2-streaming', 'a3']);
  });

  it('focuses only the latest assistant group in the public transcript group projection', () => {
    const groups = buildCanonicalTranscriptGroups([
      message('a1', { role: 'assistant' }),
      message('u1', { role: 'user', createdAt: '2026-06-03T00:01:00.000Z' }),
      message('a2', { role: 'assistant', createdAt: '2026-06-03T00:02:00.000Z' }),
    ]);

    expect(groups.map((group) => ({
      role: group.role,
      focused: group.focused,
      ids: group.messages.map((item) => item.id),
    }))).toEqual([
      { role: 'assistant', focused: false, ids: ['a1'] },
      { role: 'user', focused: false, ids: ['u1'] },
      { role: 'assistant', focused: true, ids: ['a2'] },
    ]);
  });

  it('does not focus a trailing user group', () => {
    const groups = buildCanonicalTranscriptGroups([
      message('a1', { role: 'assistant' }),
      message('u1', { role: 'user', createdAt: '2026-06-03T00:01:00.000Z' }),
    ]);

    expect(groups.map((group) => group.focused)).toEqual([false, false]);
  });
});
