import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Zhiyu voice does not implement a private or direct STT/TTS transport', async () => {
  const files = [
    'src/shell/agent-chat/ZhiyuAgentChatPieces.tsx',
    'src/shell/agent-chat/ZhiyuAgentChatSurface.tsx',
    'src/shell/agent-chat/voice-playback.ts',
    'src/shell/agent-chat/voice-capture.ts',
    'src/shell/app/voice-playback-action.ts',
  ];
  const source = (await Promise.all(files.map((file) => readFile(path.join(root, file), 'utf8')))).join('\n');

  assert.doesNotMatch(source, /\b(?:whisper|webkitSpeechRecognition|SpeechRecognition|openai\/audio\/transcriptions)\b/u);
  assert.doesNotMatch(source, /\/v1\/audio\/(?:speech|transcriptions)/u);
  assert.doesNotMatch(source, /runtime\/internal|apps\/desktop/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b/u);
  assert.doesNotMatch(source, /new Runtime\s*\(/u);
});
