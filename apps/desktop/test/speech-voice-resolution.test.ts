import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSpeechVoiceId } from '../src/runtime/hook/services/speech/voice-resolution';

function buildContext(voices: string[], shouldThrow = false) {
  return {
    speechEngine: {
      listVoices: async () => {
        if (shouldThrow) {
          throw new Error('voice-list-failed');
        }
        return voices.map((voice) => ({ id: voice }));
      },
    },
  } as any;
}

test('returns requested voice when available', async () => {
  const resolved = await resolveSpeechVoiceId({
    context: buildContext(['Cherry', 'Ethan']),
    providerId: 'dashscope-compatible',
    routeSource: 'token-api',
    connectorId: 'connector-1',
    model: 'cloud/qwen3-tts-instruct-flash-2026-01-26',
    requestedVoiceId: 'Cherry',
  });
  assert.equal(resolved, 'Cherry');
});

test('normalizes case when requested voice casing differs', async () => {
  const resolved = await resolveSpeechVoiceId({
    context: buildContext(['Cherry', 'Ethan']),
    providerId: 'dashscope-compatible',
    routeSource: 'token-api',
    connectorId: 'connector-1',
    model: 'cloud/qwen3-tts-instruct-flash-2026-01-26',
    requestedVoiceId: 'cherry',
  });
  assert.equal(resolved, 'Cherry');
});

test('falls back to first available voice when requested voice is unsupported', async () => {
  const resolved = await resolveSpeechVoiceId({
    context: buildContext(['Cherry', 'Ethan']),
    providerId: 'dashscope-compatible',
    routeSource: 'token-api',
    connectorId: 'connector-1',
    model: 'cloud/qwen3-tts-instruct-flash-2026-01-26',
    requestedVoiceId: 'alloy',
  });
  assert.equal(resolved, 'Cherry');
});

test('falls back to first available voice when requested voice is empty', async () => {
  const resolved = await resolveSpeechVoiceId({
    context: buildContext(['Cherry', 'Ethan']),
    providerId: 'dashscope-compatible',
    routeSource: 'token-api',
    connectorId: 'connector-1',
    model: 'cloud/qwen3-tts-instruct-flash-2026-01-26',
    requestedVoiceId: '',
  });
  assert.equal(resolved, 'Cherry');
});

test('falls back to model-compatible voice when voice listing fails', async () => {
  const resolved = await resolveSpeechVoiceId({
    context: buildContext([], true),
    providerId: 'dashscope-compatible',
    routeSource: 'token-api',
    connectorId: 'connector-1',
    model: 'cloud/qwen3-tts-instruct-flash-2026-01-26',
    requestedVoiceId: 'alloy',
  });
  assert.equal(resolved, 'Cherry');
});

test('normalizes stale voice catalog result by model family', async () => {
  const resolved = await resolveSpeechVoiceId({
    context: buildContext(['alloy', 'nova']),
    providerId: 'openai-compatible',
    routeSource: 'token-api',
    connectorId: 'connector-1',
    model: 'cloud/qwen3-tts-instruct-flash-2026-01-26',
    requestedVoiceId: 'alloy',
  });
  assert.equal(resolved, 'Cherry');
});
