import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { normalizeRealtimeMessagePayload } from '../src/shell/renderer/features/realtime/chat-realtime-cache';

const VIDEO_PLAYERS_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/home/video-players.tsx'),
  'utf8',
);

test('normalizeRealtimeMessagePayload rejects unknown message types', () => {
  assert.equal(
    normalizeRealtimeMessagePayload({
      id: 'msg-1',
      chatId: 'chat-1',
      senderId: 'user-1',
      type: 'UNSUPPORTED',
      createdAt: '2026-03-21T00:00:00.000Z',
      isRead: false,
      payload: null,
    }),
    null,
  );
});

test('normalizeRealtimeMessagePayload accepts canonical message types', () => {
  const normalized = normalizeRealtimeMessagePayload({
    id: 'msg-2',
    chatId: 'chat-1',
    senderId: 'user-1',
    type: 'TEXT',
    createdAt: '2026-03-21T00:00:00.000Z',
    isRead: false,
    payload: null,
  });

  assert.equal(normalized?.type, 'TEXT');
});

test('NativeVideoPlayer handles rejected play() promises without leaking unhandled rejections', () => {
  assert.match(VIDEO_PLAYERS_SOURCE, /await videoRef\.current\.play\(\)/);
  assert.match(VIDEO_PLAYERS_SOURCE, /catch \{\s+setIsPlaying\(false\);/);
});
