import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const chatSourceRoot = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/chat',
);

function readChatSource(fileName: string): string {
  return readFileSync(resolve(chatSourceRoot, fileName), 'utf8');
}

test('desktop consumes Kit avatar voice playback cues instead of owning the estimator', () => {
  assert.equal(
    existsSync(resolve(chatSourceRoot, 'chat-agent-voice-playback-state.ts')),
    false,
  );
  assert.equal(
    existsSync(resolve(chatSourceRoot, 'chat-agent-voice-playback-envelope.ts')),
    false,
  );

  assert.match(
    readChatSource('chat-agent-voice-capture.ts'),
    /from '@nimiplatform\/kit\/features\/avatar\/headless'/,
  );
  assert.match(
    readChatSource('chat-shared-runtime-stream-ui.tsx'),
    /from '@nimiplatform\/kit\/features\/avatar\/runtime'/,
  );
});
