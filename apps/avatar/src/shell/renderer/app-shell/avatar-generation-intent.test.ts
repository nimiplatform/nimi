import { describe, expect, it } from 'vitest';
import { buildAvatarSpeechTranscriptionSubmitRequest } from './avatar-generation-intent.js';

describe('Avatar canonical generation intent', () => {
  it('submits speech transcription with canonical request identity only', () => {
    const request = buildAvatarSpeechTranscriptionSubmitRequest({
      subjectUserId: 'account-1',
      mimeType: 'audio/webm',
      audioBytes: new Uint8Array([1, 2, 3]),
      language: 'en',
      requestId: 'avatar-stt-request',
      idempotencyKey: 'avatar-stt-idempotency',
    });

    expect(request.head).toEqual({
      appId: 'nimi.avatar',
      subjectUserId: 'account-1',
      timeoutMs: 90_000,
    });
  });
});
