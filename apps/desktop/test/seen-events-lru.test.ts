import assert from 'node:assert/strict';
import test from 'node:test';

import { rememberSeenEvent } from '../src/shell/renderer/features/realtime/use-chat-realtime-sync';

test('D-NET-006: rememberSeenEvent promotes existing entries and reports duplicates', () => {
  const seen = new Map<string, number>([
    ['oldest', 1],
    ['middle', 2],
    ['newest', 3],
  ]);

  const duplicate = rememberSeenEvent(seen, 'middle');

  assert.equal(duplicate, true);
  assert.deepEqual([...seen.keys()], ['oldest', 'newest', 'middle']);
});

test('D-NET-006: rememberSeenEvent ignores empty keys', () => {
  const seen = new Map<string, number>();

  assert.equal(rememberSeenEvent(seen, '   '), false);
  assert.equal(seen.size, 0);
});

test('D-NET-006: rememberSeenEvent evicts the oldest entry once capacity is exceeded', () => {
  const seen = new Map<string, number>();
  for (let index = 0; index < 3000; index += 1) {
    seen.set(`event-${index}`, index);
  }

  const duplicate = rememberSeenEvent(seen, 'event-3000');

  assert.equal(duplicate, false);
  assert.equal(seen.size, 3000);
  assert.equal(seen.has('event-0'), false);
  assert.equal(seen.has('event-3000'), true);
  assert.equal([...seen.keys()][0], 'event-1');
});
