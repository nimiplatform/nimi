import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Zhiyu voice hardcut leaves no deferred voice product variants or app-local STT/TTS', async () => {
  const files = [
    'src/shell/agent-chat/ZhiyuAgentChatPieces.tsx',
    'src/shell/agent-chat/ZhiyuAgentChatSurface.tsx',
    'src/shell/agent-chat/voice-playback.ts',
    'src/shell/agent-chat/voice-capture.ts',
    'src/shell/app/voice-playback-action.ts',
  ];
  const source = (await Promise.all(files.map((file) => readFile(path.join(root, file), 'utf8')))).join('\n');
  const retiredDeferred = ['defer', 'red'].join('');

  assert.doesNotMatch(source, new RegExp(`voice[_-]?(?:capture|playback|state|surface)[\\s\\S]{0,120}${retiredDeferred}`, 'iu'));
  assert.doesNotMatch(source, new RegExp(`${retiredDeferred}[\\s\\S]{0,120}voice[_-]?(?:capture|playback|state|surface)`, 'iu'));
  assert.doesNotMatch(source, new RegExp(`zhiyu-chat-voice-[a-z-]*${retiredDeferred}`, 'iu'));
  assert.doesNotMatch(source, /语音(?:输入|模式)?暂未接入/u);
  assert.doesNotMatch(source, /\b(?:whisper|webkitSpeechRecognition|SpeechRecognition|openai\/audio\/transcriptions)\b/u);
  assert.doesNotMatch(source, /\/v1\/audio\/(?:speech|transcriptions)/u);
  assert.match(source, /audio\.transcribe/u);
  assert.match(source, /runNimiRuntimeSpeechTranscription/u);
  assert.match(source, /createNimiRuntimeAgentVoiceModule/u);
  assert.match(source, /voice\.subscribeStream/u);
  assert.doesNotMatch(source, /zhiyuLocalAppRuntimePlatform/u);
  assert.doesNotMatch(source, /\.agent\.transcribeVoice|\.agent\.subscribeVoiceStream/u);
  assert.doesNotMatch(source, /new Runtime\s*\(/u);
});
