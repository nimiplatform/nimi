import assert from 'node:assert/strict';
import test from 'node:test';

import { formatChatThreadRelativeTime } from '../src/shell/renderer/features/chat/chat-nimi-session-list-panel';

const NOW_MS = Date.UTC(2026, 6, 21, 12, 0, 0);

test('chat thread relative time is determined by the renderer clock projection', () => {
  assert.equal(formatChatThreadRelativeTime('2026-07-21T11:59:30.000Z', NOW_MS), 'just now');
  assert.equal(formatChatThreadRelativeTime('2026-07-21T11:55:00.000Z', NOW_MS), '5m');
  assert.equal(formatChatThreadRelativeTime('2026-07-20T12:00:00.000Z', NOW_MS), '1d');
  assert.equal(formatChatThreadRelativeTime('not-a-date', NOW_MS), 'not-a-date');
});
