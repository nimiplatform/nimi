import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VIDEO_PLAYERS_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/home/video-players.tsx'),
  'utf8',
);

test('NativeVideoPlayer handles rejected play() promises without leaking unhandled rejections', () => {
  assert.match(VIDEO_PLAYERS_SOURCE, /await videoRef\.current\.play\(\)/);
  assert.match(VIDEO_PLAYERS_SOURCE, /catch \{\s+setIsPlaying\(false\);/);
});
